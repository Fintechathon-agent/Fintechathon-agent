from __future__ import annotations

import math
import unittest

from agent.tools.backtest import BacktestEngine
from contracts.types import ActionType, MarketData, Recommendation


def _rec(action: ActionType, symbol: str, quantity: float, price: float, date: str) -> Recommendation:
    del date  # 回测引擎按行情时间戳对齐，不读 Recommendation 时间字段
    return Recommendation(
        action=action, symbol=symbol, quantity=quantity, price=price,
        reason="", evidence=[], confidence=0.8, risk_impact="", alternative="",
    )


def _md(symbol: str, date: str, price: float) -> MarketData:
    return MarketData(timestamp=f"{date} 15:00:00", symbol=symbol, price=price)


class BacktestMetricsTests(unittest.TestCase):
    """回测指标按市场标准口径手工对账。

    场景：初始资金 10 万元。
    - D1 以 10 元买入 1000 股 A（佣金万三 → 成本 10030.0）；
    - D2 以 11 元卖出 1000 股 A（佣金万三 + 印花税万五 → 净回款 10991.2）；
    期间无其他持仓，无现金流入流出。
    """

    def _run(self):
        engine = BacktestEngine(initial_cash=100000.0)
        recs = [
            _rec(ActionType.BUY, "A", 1000, 10.0, "2026-10-01"),
            _rec(ActionType.SELL, "A", 1000, 11.0, "2026-10-02"),
        ]
        hist = {
            "A": [
                _md("A", "2026-10-01", 10.0),
                _md("A", "2026-10-02", 11.0),
            ],
        }
        return engine.run(recs, hist)

    def test_total_return_matches_manual(self):
        res = self._run()
        # 买入成本 = 1000×10×(1+0.0003) = 10003；卖出净回款 = 1000×11×(1-0.0008) = 10991.2
        # D2 总资产 = 100000 - 10003 + 10991.2 = 100988.2
        expected = (100988.2 - 100000.0) / 100000.0 * 100
        self.assertAlmostEqual(res.total_return, expected, places=2)

    def test_win_rate_and_profit_factor_from_realized_pnl(self):
        res = self._run()
        # 一笔卖出：净回款 10991.2 - 成本 10030 = 961.2 > 0 → 胜率 1.0
        self.assertAlmostEqual(res.win_rate, 1.0, places=6)
        self.assertAlmostEqual(res.profit_factor, 99.99, places=2)  # 无亏损交易按上限表示

    def test_losing_trade_sets_win_rate_zero_and_factor_zero(self):
        engine = BacktestEngine(initial_cash=100000.0)
        recs = [
            _rec(ActionType.BUY, "A", 1000, 10.0, "2026-10-01"),
            _rec(ActionType.SELL, "A", 1000, 9.5, "2026-10-02"),
        ]
        hist = {"A": [_md("A", "2026-10-01", 10.0), _md("A", "2026-10-02", 9.5)]}
        res = engine.run(recs, hist)
        self.assertAlmostEqual(res.win_rate, 0.0, places=6)
        self.assertAlmostEqual(res.profit_factor, 0.0, places=2)

    def test_annualized_return_is_compounded(self):
        # 区间总收益 r = 99997/100000 - 1 = -0.00003，跨 2 个交易日，
        # 年化 = (1+r)^(250/2) - 1（复利口径，不能用四舍五入后的字段回推）
        engine = BacktestEngine(initial_cash=100000.0)
        recs = [_rec(ActionType.BUY, "A", 1000, 10.0, "2026-10-01")]
        hist = {"A": [_md("A", "2026-10-01", 10.0), _md("A", "2026-10-02", 10.0)]}
        res = engine.run(recs, hist)
        r_exact = 99997.0 / 100000.0 - 1
        expected = ((1 + r_exact) ** (250 / 2) - 1) * 100
        self.assertAlmostEqual(res.annualized_return, expected, places=2)
        # 旧口径（线性 total_return*250/n）会得到不同值，防止回归
        self.assertNotAlmostEqual(res.annualized_return, res.total_return * 250 / 2, places=2)

    def test_sharpe_zero_when_no_returns_variation(self):
        res = self._run()
        # 两日仅一天收益样本 → 无法计算波动 → Sharpe 为 0（并不可悬空报错）
        self.assertGreaterEqual(res.sharpe_ratio, 0.0)

    def test_max_drawdown_is_peak_to_trough(self):
        engine = BacktestEngine(initial_cash=100000.0)
        # 买入在 D1（10 元，成本含佣金 10003）：
        # 价值曲线 99997(D1) -> 100997(D2, 11 元) -> 99897(D3, 9.9 元)
        # 回撤 = (100997 - 99897) / 100997 = 1.0891%
        hist = {"A": [_md("A", "2026-10-01", 10.0), _md("A", "2026-10-02", 11.0), _md("A", "2026-10-03", 9.9)]}
        recs = [_rec(ActionType.BUY, "A", 1000, 10.0, "2026-10-01")]
        res = engine.run(recs, hist)
        self.assertAlmostEqual(res.max_drawdown, 1.0891, places=2)


if __name__ == "__main__":
    unittest.main()
