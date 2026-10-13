"""回测引擎——基于历史数据验证交易策略表现。
参考 FinRL_DeepSeek 和 RakshaQuant 的回测框架。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from contracts.types import MarketData, Position, Recommendation, ActionType

logger = logging.getLogger(__name__)


@dataclass
class BacktestResult:
    """回测结果"""
    total_return: float          # 总收益率 %
    annualized_return: float     # 年化收益率 %
    sharpe_ratio: float          # 夏普比率
    max_drawdown: float          # 最大回撤 %
    win_rate: float              # 胜率（盈利交易/总交易）
    total_trades: int            # 总交易次数
    profit_factor: float         # 盈利因子（总盈利/总亏损）
    daily_returns: list[float]   # 每日收益率序列
    reason: str                  # 回测说明


class BacktestEngine:
    """回测引擎——用历史行情模拟策略表现"""

    def __init__(self, initial_cash: float = 100000.0):
        self.initial_cash = initial_cash

    def run(
        self,
        recommendations: list[Recommendation],
        historical_data: dict[str, list[MarketData]],
        start_date: str = "",
        end_date: str = "",
    ) -> BacktestResult:
        """执行回测

        recommendations: 策略生成的推荐操作序列（按时间排序）
        historical_data: {symbol: [MarketData, ...]} 历史行情
        """
        cash = self.initial_cash
        holdings: dict[str, float] = {}       # symbol -> quantity
        cost_basis: dict[str, float] = {}     # symbol -> 持仓总成本（含买入手续费）
        trades: list[dict] = []
        daily_values: list[float] = [cash]
        daily_returns: list[float] = [0.0]

        # 费用模型：买入佣金万三（含在成本法成本里）；
        # 卖出佣金万三 + 股票印花税万五（2023-08 后单边卖出 0.05%），场内 ETF/LOF 免印花税。
        # 场外基金（.OF）申赎不走日线撮合，本引擎跳过。
        from .fund_ops import is_exchange_fund, is_otc_fund

        BUY_FEE = 0.0003

        def sell_fee(symbol: str) -> float:
            return 0.0003 + (0.0 if is_exchange_fund(symbol) else 0.0005)

        # 按时间线合并所有行情
        all_dates: set[str] = set()
        for series in historical_data.values():
            for md in series:
                all_dates.add(md.timestamp[:10])
        sorted_dates = sorted(all_dates)
        date_set = set(sorted_dates)

        # 撮合语义：推荐按输入顺序视为时间序列，每笔排在"上一笔撮合日之后、
        # 该标的下一个可得交易日"；无行情或资金/持仓不足则跳过该笔（不重复撮合）。
        last_date = ""
        scheduled: dict[str, list[tuple[Recommendation, float]]] = {}
        for rec in recommendations:
            if is_otc_fund(rec.symbol):
                continue   # 场外基金申赎按净值确认，不走日线撮合
            price_data = historical_data.get(rec.symbol, [])
            if not price_data:
                continue
            entry = next(
                (md for md in price_data
                 if md.timestamp[:10] > last_date and md.timestamp[:10] in date_set),
                None,
            )
            if entry is None:
                continue
            date_str = entry.timestamp[:10]
            last_date = date_str
            scheduled.setdefault(date_str, []).append((rec, entry.price))

        for date_str in sorted_dates:
            # 当日撮合
            for rec, price in scheduled.get(date_str, []):
                if rec.action == ActionType.BUY and cash >= price * rec.quantity * (1 + BUY_FEE):
                    amount = price * rec.quantity
                    cost = amount * (1 + BUY_FEE)
                    cash -= cost
                    holdings[rec.symbol] = holdings.get(rec.symbol, 0) + rec.quantity
                    cost_basis[rec.symbol] = cost_basis.get(rec.symbol, 0.0) + cost
                    trades.append({"date": date_str, "action": "BUY", "symbol": rec.symbol,
                                   "price": price, "quantity": rec.quantity, "realized_pnl": 0.0})

                elif rec.action == ActionType.SELL and holdings.get(rec.symbol, 0) >= rec.quantity:
                    qty = rec.quantity
                    amount = price * qty
                    revenue = amount * (1 - sell_fee(rec.symbol))
                    # 已实现盈亏 = 卖出净收入 - 对应数量份额的持仓成本（成本法）
                    avg_cost_per_share = cost_basis.get(rec.symbol, 0.0) / holdings[rec.symbol]
                    realized = revenue - avg_cost_per_share * qty
                    cash += revenue
                    holdings[rec.symbol] -= qty
                    cost_basis[rec.symbol] = max(cost_basis.get(rec.symbol, 0.0) - avg_cost_per_share * qty, 0.0)
                    if holdings[rec.symbol] <= 0:
                        del holdings[rec.symbol]
                        cost_basis.pop(rec.symbol, None)
                    trades.append({"date": date_str, "action": "SELL", "symbol": rec.symbol,
                                   "price": price, "quantity": qty, "realized_pnl": realized})

            # 当日总资产（现金 + 持仓按当日收盘价计）
            portfolio_value = sum(
                holdings.get(sym, 0) * next(
                    (md.price for md in historical_data.get(sym, [])
                     if md.timestamp[:10] == date_str), 0.0
                )
                for sym in holdings
            )
            total_value = cash + portfolio_value
            daily_values.append(total_value)
            prev = daily_values[-2]
            daily_returns.append(total_value / prev - 1.0 if prev > 0 else 0.0)

        # ---- 指标计算（市场标准口径）----
        # 总收益率（%）与年化收益率（复利口径，(1+R)^(250/n)-1）
        total_return = (daily_values[-1] - self.initial_cash) / self.initial_cash * 100
        n_days = max(len(daily_values) - 1, 1)
        r_total = daily_values[-1] / self.initial_cash - 1.0
        annualized_return = ((1 + r_total) ** (250 / n_days) - 1.0) * 100

        # 夏普比率：日收益序列的年化（均值/标准差 × √250，无风险利率按 0 计）
        rets = daily_returns[1:]
        if len(rets) > 1:
            import statistics
            mean_ret = statistics.mean(rets)
            std_ret = statistics.stdev(rets) if len(rets) > 1 else 0.0
            sharpe = (mean_ret / std_ret * (250 ** 0.5)) if std_ret > 1e-12 else 0.0
        else:
            sharpe = 0.0

        # 最大回撤
        peak = self.initial_cash
        max_dd = 0.0
        for val in daily_values:
            if val > peak:
                peak = val
            dd = (peak - val) / peak * 100
            if dd > max_dd:
                max_dd = dd

        # 胜率 / 盈利因子：按每笔卖出的已实现盈亏（卖出净收入 - 成本法持仓成本）
        sell_trades = [t for t in trades if t["action"] == "SELL"]
        wins = sum(1 for t in sell_trades if t["realized_pnl"] > 0)
        win_rate = wins / len(sell_trades) if sell_trades else 0.0
        gross_profit = sum(t["realized_pnl"] for t in sell_trades if t["realized_pnl"] > 0)
        gross_loss = abs(sum(t["realized_pnl"] for t in sell_trades if t["realized_pnl"] < 0))
        if gross_loss > 1e-12:
            profit_factor = gross_profit / gross_loss
        elif gross_profit > 0:
            profit_factor = 99.99   # 无亏损交易：盈利因子按上限表示
        else:
            profit_factor = 0.0

        return BacktestResult(
            total_return=round(total_return, 2),
            annualized_return=round(annualized_return, 2),
            sharpe_ratio=round(sharpe, 2),
            max_drawdown=round(max_dd, 2),
            win_rate=round(win_rate, 2),
            total_trades=len(trades),
            profit_factor=round(profit_factor, 2),
            daily_returns=[round(r, 4) for r in daily_returns],
            reason=f"初始资金{self.initial_cash:.0f}元，回测{n_days}个交易日，交易{len(trades)}次",
        )


def run_backtest(
    recommendations: list[Recommendation],
    historical_data: dict[str, list[MarketData]],
    initial_cash: float = 100000.0,
) -> BacktestResult:
    return BacktestEngine(initial_cash).run(recommendations, historical_data)
