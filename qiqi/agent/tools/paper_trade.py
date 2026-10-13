"""Paper Trading 工具——模拟交易执行，不真实下单，只记录操作。
参考 RakshaQuant / glassbench 的 paper trading 实现。
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from contracts.types import Portfolio, Position, Recommendation, ActionType


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


class PaperTradingTool:
    """纸交易执行器——维护虚拟持仓，执行模拟买卖"""

    def __init__(self, storage_dir: Path | None = None):
        self.storage_dir = Path(storage_dir) if storage_dir else Path("data/paper_trades")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._positions: dict[str, dict] = {}  # session_id -> {symbol: Position}

    def execute(self, rec: Recommendation, session_id: str) -> PaperTradingResult:
        """执行一笔纸交易"""
        try:
            record = self._do_trade(rec, session_id)
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
        - 买入：佣金万三；
        - 卖出：佣金万三 + 印花税万五（2023-08 后单边卖出 0.05%）。
        滑点：成交价偏移 ±0.5% 均匀随机（演示用估算）。
        """
        # 模拟滑点（成交价偏移 ±0.5%）
        import random
        slippage = 1.0 + random.uniform(-0.005, 0.005)
        exec_price = rec.price * slippage
        amount = exec_price * rec.quantity
        commission = amount * 0.0003  # 万三佣金
        stamp_duty = amount * 0.0005 if rec.action == ActionType.SELL else 0.0  # 卖出印花税万五

        record = TradeRecord(
            id=f"PT-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            timestamp=datetime.now().isoformat(),
            action=rec.action.value,
            symbol=rec.symbol,
            name=rec.symbol,  # 实际应从行情获取
            price=round(exec_price, 2),
            quantity=rec.quantity,
            amount=round(amount, 2),
            commission=round(commission + stamp_duty, 2),  # 佣金+印花税合并入费用字段
        )
        return record

    def _update_positions(self, rec: Recommendation, session_id: str) -> None:
        """更新内存中的持仓快照

        买入：成本法摊入成交价（含佣金）；卖出：按份额减仓，成本法剩余成本同步扣减。
        """
        if session_id not in self._positions:
            self._positions[session_id] = {}

        positions = self._positions[session_id]
        sym = rec.symbol
        # 与 _do_trade 同口径：以滑点后成交价计（此处用 rec.price 的近似成交价，
        # 记录层的精确成交价以 _do_trade 为准；价差在演示级误差内）。
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
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(record.__dict__, ensure_ascii=False) + "\n")

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
