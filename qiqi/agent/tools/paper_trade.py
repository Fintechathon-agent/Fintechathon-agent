"""Paper Trading 工具——模拟交易执行，不真实下单，只记录操作。
参考 RakshaQuant / glassbench 的 paper trading 实现。
"""
from __future__ import annotations

import json
import uuid
import math
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from contracts.types import Portfolio, Position, Recommendation, ActionType
from agent.core.storage import atomic_write_text, storage_lock


@dataclass
class TradeRecord:
    """成交记录"""
    id: str
    session_id: str
    timestamp: str
    action: str           # BUY / SELL
    symbol: str
    name: str
    price: float          # 成交价
    quantity: float       # 成交数量
    amount: float         # 成交金额
    commission: float     # 手续费
    status: str = "filled"  # filled / cancelled / rejected


@dataclass
class PaperTradingResult:
    """纸交易执行结果"""
    success: bool
    trade_record: Optional[TradeRecord] = None
    message: str = ""
    updated_portfolio: Optional[Portfolio] = None


def apply_trade_record(portfolio: Portfolio, record: TradeRecord) -> None:
    """Apply the persisted fill, including actual fees and OTC units, exactly once."""
    if record.status != "filled":
        raise ValueError("非成交回执不能更新持仓")
    values = (record.quantity, record.price, record.amount, record.commission)
    if not all(math.isfinite(float(v)) for v in values) or min(values[:3]) <= 0 or not 0 <= record.commission <= record.amount:
        raise ValueError("成交回执数值无效")
    position = next((p for p in portfolio.positions if p.symbol == record.symbol), None)
    if record.action in (ActionType.BUY.value, "申购"):
        qty = round((record.amount - record.commission) / record.price, 2) if record.action == "申购" else record.quantity
        if qty <= 0:
            raise ValueError("成交回执中的费用超过成交金额")
        cost = round(record.amount + (0 if record.action == "申购" else record.commission), 2)
        if cost > round(portfolio.cash, 2):
            raise ValueError("可用资金不足支付成交金额和费用")
        portfolio.cash = round(portfolio.cash - cost, 2)
        if position:
            total_cost = position.avg_cost * position.quantity + cost
            position.quantity += qty
            position.avg_cost = total_cost / position.quantity
        else:
            portfolio.positions.append(Position(
                symbol=record.symbol, name=record.name, quantity=qty, avg_cost=cost / qty,
                current_price=record.price, market_value=qty * record.price, return_pct=0,
                sector="未分类", asset_type="fund" if record.action == "申购" else "stock",
            ))
    elif record.action in (ActionType.SELL.value, "赎回"):
        if position is None or record.quantity > position.quantity:
            raise ValueError("可用持仓不足，不能超额卖出")
        proceeds = record.amount - (0 if record.action == "赎回" else record.commission)
        portfolio.cash = round(portfolio.cash + proceeds, 2)
        position.quantity = round(position.quantity - record.quantity, 8)
        if position.quantity <= 0:
            portfolio.positions.remove(position)
    else:
        raise ValueError("成交回执缺少明确买卖方向")


class PaperTradingTool:
    """纸交易执行器——维护虚拟持仓，执行模拟买卖"""

    def __init__(self, storage_dir: Path | None = None):
        self.storage_dir = Path(storage_dir) if storage_dir else Path("data/paper_trades")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._positions: dict[str, dict] = {}  # session_id -> {symbol: Position}
        self.lock = storage_lock(self.storage_dir)

    def execute_once(self, rec: Recommendation, approval_id: str, portfolio: Portfolio | None = None) -> PaperTradingResult:
        """One durable receipt per approval; never replay an already filled order."""
        with self.lock:
            existing = self.get_trade_history(approval_id)
            if existing:
                return PaperTradingResult(True, existing[0], "已执行，返回原成交回执")
            result = self.execute(rec, approval_id, portfolio=portfolio) if portfolio is not None else self.execute(rec, approval_id)
            # The durable receipt is authoritative even if a later in-memory update failed.
            receipts = self.get_trade_history(approval_id)
            if receipts:
                return PaperTradingResult(True, receipts[0], result.message)
            if result.success:
                return PaperTradingResult(False, message="执行器未提供持久化成交回执")
            return result

    def execute(self, rec: Recommendation, session_id: str, portfolio: Portfolio | None = None) -> PaperTradingResult:
        """执行一笔纸交易"""
        try:
            record = self._do_trade(rec, session_id)
            if portfolio is not None:
                apply_trade_record(deepcopy(portfolio), record)
            # 持久化
            self._save_record(record)
            # 更新内存持仓
            self._update_positions(rec, session_id)
            return PaperTradingResult(
                success=True,
                trade_record=record,
                message=f"{rec.action.value} {rec.quantity}股 {rec.symbol} 成交价 {rec.price:.2f}",
            )
        except Exception as exc:
            return PaperTradingResult(success=False, message=str(exc))

    def _do_trade(self, rec: Recommendation, session_id: str) -> TradeRecord:
        """执行交易逻辑

        费用模型（与回测引擎一致）：
        - 股票：买入佣金万三；卖出佣金万三 + 印花税万五（2023-08 后单边卖出 0.05%）。
        - 场内 ETF/LOF：佣金万三，卖出免印花税（交易所规则）。
        - 场外基金（symbol 带 .OF）：申购按金额/赎回按份额，无滑点按净值成交，
          申购费 0.15%、赎回费按持有天数分档，计算见 fund_ops（演示同速确认，真实 T+1）。
        """
        import random

        from .fund_ops import is_exchange_fund, is_otc_fund, otc_redeem, otc_subscribe

        is_otc = is_otc_fund(rec.symbol)
        is_etf = is_exchange_fund(rec.symbol)
        action_label = rec.action.value

        if is_otc:
            # 场外基金：按净值成交，无滑点；quantity 语义：买入=申购金额，卖出=赎回份额
            nav = rec.price
            if rec.action == ActionType.BUY:
                res = otc_subscribe(rec.quantity, nav)
                amount = res.amount
                fee = res.fee
                exec_price = nav
                action_label = "申购"
            else:
                hold_days = self._otc_hold_days(session_id, rec.symbol)
                res = otc_redeem(rec.quantity, nav, hold_days)
                amount = res.net_amount
                fee = res.fee
                exec_price = nav
                action_label = "赎回"
            commission = fee
        else:
            # 交易所证券（股票/场内 ETF）：滑点 ±0.5% 均匀随机（演示估算）
            slippage = 1.0 + random.uniform(-0.005, 0.005)
            exec_price = rec.price * slippage
            amount = exec_price * rec.quantity
            commission = amount * 0.0003  # 万三佣金
            if rec.action == ActionType.SELL and not is_etf:
                commission += amount * 0.0005  # 股票卖出印花税万五；ETF/LOF 免

        record = TradeRecord(
            id=f"PT-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            timestamp=datetime.now().isoformat(),
            action=action_label,
            symbol=rec.symbol,
            name=rec.symbol,  # 实际应从行情获取
            price=exec_price if is_otc else round(exec_price, 2),
            quantity=rec.quantity,
            amount=round(amount, 2),
            commission=round(commission, 2),
        )
        return record

    def _otc_hold_days(self, session_id: str, symbol: str) -> int:
        """场外基金持有天数：自首笔申购至今（分档费率的演示简化口径）。"""
        pos = self._positions.get(session_id, {}).get(symbol)
        first_buy = pos.get("first_buy") if pos else None
        if not first_buy:
            return 0
        days = (date.today() - date.fromisoformat(first_buy)).days
        return max(days, 0)

    def _update_positions(self, rec: Recommendation, session_id: str) -> None:
        """更新内存中的持仓快照

        - 股票/场内 ETF：成本法摊入成交价（含佣金）。
        - 场外基金：申购按金额换算份额（含申购费），赎回按份额扣减；净值估值。
        """
        from .fund_ops import is_otc_fund, otc_subscribe

        if session_id not in self._positions:
            self._positions[session_id] = {}

        positions = self._positions[session_id]
        sym = rec.symbol

        if is_otc_fund(sym):
            today = date.today().isoformat()
            nav = rec.price
            if rec.action == ActionType.BUY:
                res = otc_subscribe(rec.quantity, nav)
                if sym in positions:
                    old = positions[sym]
                    total_shares = old["quantity"] + res.shares
                    positions[sym] = {
                        "symbol": sym,
                        "name": old.get("name", sym),
                        "quantity": total_shares,
                        "avg_cost": nav,
                        "current_price": nav,
                        "first_buy": old.get("first_buy", today),
                    }
                else:
                    positions[sym] = {
                        "symbol": sym,
                        "name": sym,
                        "quantity": res.shares,
                        "avg_cost": nav,
                        "current_price": nav,
                        "first_buy": today,
                    }
            elif rec.action == ActionType.SELL:
                if sym in positions:
                    positions[sym]["quantity"] -= rec.quantity  # 赎回份额
                    if positions[sym]["quantity"] <= 0:
                        del positions[sym]
            return

        # 股票 / 场内 ETF：成本法（佣金入成本）
        exec_price = rec.price
        if rec.action == ActionType.BUY:
            commission = exec_price * rec.quantity * 0.0003
            total_cost_with_fee = exec_price * rec.quantity + commission
            if sym in positions:
                old = positions[sym]
                total_cost = old["avg_cost"] * old["quantity"] + total_cost_with_fee
                total_qty = old["quantity"] + rec.quantity
                positions[sym] = {
                    "symbol": sym,
                    "name": old.get("name", sym),
                    "quantity": total_qty,
                    "avg_cost": total_cost / total_qty,
                    "current_price": exec_price,
                }
            else:
                positions[sym] = {
                    "symbol": sym,
                    "name": sym,
                    "quantity": rec.quantity,
                    "avg_cost": total_cost_with_fee / rec.quantity,
                    "current_price": exec_price,
                }
        elif rec.action == ActionType.SELL:
            if sym in positions:
                positions[sym]["quantity"] -= rec.quantity
                if positions[sym]["quantity"] <= 0:
                    del positions[sym]

    def _save_record(self, record: TradeRecord) -> None:
        """持久化成交记录"""
        p = self.storage_dir / f"{record.session_id}_trades.jsonl"
        with self.lock:
            previous = p.read_text(encoding="utf-8") if p.exists() else ""
            atomic_write_text(p, previous + json.dumps(record.__dict__, ensure_ascii=False, allow_nan=False) + "\n")

    def get_positions(self, session_id: str) -> list[Position]:
        """获取当前虚拟持仓"""
        data = self._positions.get(session_id, {})
        return [
            Position(
                symbol=sym,
                name=info.get("name", sym),
                quantity=info["quantity"],
                avg_cost=info["avg_cost"],
                current_price=info["current_price"],
                market_value=info["current_price"] * info["quantity"],
                return_pct=(info["current_price"] - info["avg_cost"]) / info["avg_cost"] * 100,
                asset_type="fund" if "first_buy" in info else "stock",
            )
            for sym, info in data.items()
        ]

    def get_trade_history(self, session_id: str) -> list[TradeRecord]:
        """获取交易历史"""
        p = self.storage_dir / f"{session_id}_trades.jsonl"
        if not p.exists():
            return []
        records = []
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                records.append(TradeRecord(**d))
        return records


# ------------------------------------------------------------ 快捷函数


_paper_trader: Optional[PaperTradingTool] = None


def get_paper_trader() -> PaperTradingTool:
    global _paper_trader
    if _paper_trader is None:
        _paper_trader = PaperTradingTool()
    return _paper_trader


def execute_trade(rec: Recommendation, session_id: str) -> PaperTradingResult:
    return get_paper_trader().execute(rec, session_id)
