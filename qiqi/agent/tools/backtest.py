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
        holdings: dict[str, float] = {}  # symbol -> quantity
        trades: list[dict] = []
        daily_values: list[float] = [cash]
        daily_returns: list[float] = [0.0]

        # 按时间线合并所有行情
        all_dates: set[str] = set()
        for series in historical_data.values():
            for md in series:
                all_dates.add(md.timestamp[:10])
        sorted_dates = sorted(all_dates)

        for date_str in sorted_dates:
            # 当日交易信号
            day_recs = [r for r in recommendations if r.symbol in historical_data
                        and any(md.timestamp[:10] == date_str for md in historical_data[r.symbol])]
            for rec in day_recs:
                price_data = historical_data.get(rec.symbol, [])
                price = next((md.price for md in price_data if md.timestamp[:10] == date_str), None)
                if price is None:
                    continue

                if rec.action == ActionType.BUY and cash >= price * rec.quantity:
                    cost = price * rec.quantity * 1.0003  # 假设万三手续费
                    cash -= cost
                    holdings[rec.symbol] = holdings.get(rec.symbol, 0) + rec.quantity
                    trades.append({"date": date_str, "action": "BUY", "symbol": rec.symbol,
                                   "price": price, "quantity": rec.quantity})

                elif rec.action == ActionType.SELL and holdings.get(rec.symbol, 0) >= rec.quantity:
                    revenue = price * rec.quantity * (1 - 0.0003 - 0.001)  # 手续费+印花税
                    cash += revenue
                    holdings[rec.symbol] -= rec.quantity
                    if holdings[rec.symbol] <= 0:
                        del holdings[rec.symbol]
                    trades.append({"date": date_str, "action": "SELL", "symbol": rec.symbol,
                                   "price": price, "quantity": rec.quantity})

            # 计算当日总资产
            portfolio_value = sum(
                holdings.get(sym, 0) * next(
                    (md.price for md in historical_data.get(sym, [])
                     if md.timestamp[:10] == date_str), 0.0
                )
                for sym in holdings
            )
            total_value = cash + portfolio_value
            daily_values.append(total_value)

        # 计算指标
        total_return = (daily_values[-1] - self.initial_cash) / self.initial_cash * 100
        n_days = len(daily_values)
        annualized_return = total_return * 250 / max(n_days, 1)

        # 简单夏普比率
        if len(daily_returns) > 1:
            import statistics
            mean_ret = statistics.mean(daily_returns[1:])
            std_ret = statistics.stdev(daily_returns[1:]) if len(daily_returns) > 2 else 0.01
            sharpe = (mean_ret / std_ret * (250 ** 0.5)) if std_ret > 0 else 0.0
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

        # 胜率
        buy_trades = [t for t in trades if t["action"] == "BUY"]
        sell_trades = [t for t in trades if t["action"] == "SELL"]
        wins = sum(1 for i, s in enumerate(sell_trades) if i < len(buy_trades)
                   and s["price"] > buy_trades[i]["price"])
        win_rate = wins / max(len(sell_trades), 1)

        # 盈利因子
        gross_profit = sum(s["price"] * s["quantity"] for s in sell_trades
                          if s["price"] > 0)
        gross_loss = sum(s["price"] * s["quantity"] for s in sell_trades
                        if s["price"] < 0)
        profit_factor = gross_profit / max(gross_loss, 1)

        return BacktestResult(
            total_return=round(total_return, 2),
            annualized_return=round(annualized_return, 2),
            sharpe_ratio=round(sharpe, 2),
            max_drawdown=round(max_dd, 2),
            win_rate=round(win_rate, 2),
            total_trades=len(trades),
            profit_factor=round(profit_factor, 2),
            daily_returns=[round(r, 4) for r in daily_returns],
            reason=f"初始资金{self.initial_cash:.0f}元，回测{dates}天，交易{len(trades)}次",
        )


def run_backtest(
    recommendations: list[Recommendation],
    historical_data: dict[str, list[MarketData]],
    initial_cash: float = 100000.0,
) -> BacktestResult:
    return BacktestEngine(initial_cash).run(recommendations, historical_data)
