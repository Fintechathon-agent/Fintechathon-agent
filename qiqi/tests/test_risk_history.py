from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from agent.risk.engine import RiskEngine
from agent.tools.portfolio import PortfolioAnalyzer
from contracts.types import (
    MarketSnapshot, Portfolio, Position, RiskReport, UserProfile,
)

FIXTURE = Path(__file__).parent / "fixtures" / "real_prices_20261013.json"
# 夹具来源：akshare 前复权日线（2026-10-13 抓取，近 120 个交易日）
REAL_CLOSES: dict[str, list[float]] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _portfolio() -> Portfolio:
    # 数量固定，现价/市值取 2026-10-13 真实收盘价
    positions = [
        Position(
            symbol="600519", name="贵州茅台", quantity=100,
            avg_cost=1400.0, current_price=REAL_CLOSES["600519"][-1],
            market_value=100 * REAL_CLOSES["600519"][-1], return_pct=-8.9,
            sector="食品饮料",
        ),
        Position(
            symbol="000001", name="平安银行", quantity=5000,
            avg_cost=12.5, current_price=REAL_CLOSES["000001"][-1],
            market_value=5000 * REAL_CLOSES["000001"][-1], return_pct=-7.4,
            sector="银行",
        ),
        Position(
            symbol="510300", name="沪深300ETF", quantity=20000,
            avg_cost=4.5, current_price=REAL_CLOSES["510300"][-1],
            market_value=20000 * REAL_CLOSES["510300"][-1], return_pct=-3.4,
            sector="宽基指数",
        ),
    ]
    return Portfolio(
        user_id="u1",
        date="2026-10-13",
        positions=positions,
        total_value=sum(p.market_value for p in positions),
        cash=50000.0,
    )


def _reference_var(history: dict[str, list[float]], portfolio: Portfolio) -> float:
    """独立复算：市值权重合成日收益序列，取 5% 分位数（与引擎同口径）。"""
    series = [history[p.symbol][-120:] for p in portfolio.positions]
    min_len = min(len(s) for s in series)
    total_mv = sum(p.market_value for p in portfolio.positions)
    rets = []
    for i in range(1, min_len):
        r = sum(
            p.market_value / total_mv * (s[i] - s[i - 1]) / s[i - 1]
            for p, s in zip(portfolio.positions, series)
        )
        rets.append(r)
    idx = max(0, int(math.ceil(len(rets) * 0.05)) - 1)
    return abs(sorted(rets)[idx]) * 100


def _reference_mdd(history: dict[str, list[float]], portfolio: Portfolio) -> float:
    """独立复算：组合价值曲线（现金 + 数量×价格）的峰值到谷底最大回撤。"""
    series = [history[p.symbol][-120:] for p in portfolio.positions]
    min_len = min(len(s) for s in series)
    values = [
        portfolio.cash + sum(p.quantity * s[i] for p, s in zip(portfolio.positions, series))
        for i in range(min_len)
    ]
    peak = values[0]
    mdd = 0.0
    for v in values:
        peak = max(peak, v)
        mdd = max(mdd, (peak - v) / peak * 100)
    return mdd


class RiskHistoryTests(unittest.TestCase):
    """真实行情下的 VaR / 最大回撤：引擎结果必须与独立复算一致。"""

    def setUp(self):
        self.portfolio = _portfolio()
        self.user = UserProfile(user_id="u1", name="测试用户", max_single_loss=0.10)
        self.market = MarketSnapshot(timestamp="", data={})

    def test_historical_var_matches_independent_recompute(self):
        report = RiskEngine().check(
            self.portfolio, self.user, self.market, price_history=REAL_CLOSES,
        )
        self.assertAlmostEqual(
            report.var_95, _reference_var(REAL_CLOSES, self.portfolio), places=2,
        )

    def test_historical_max_drawdown_matches_independent_recompute(self):
        report = RiskEngine().check(
            self.portfolio, self.user, self.market, price_history=REAL_CLOSES,
        )
        self.assertAlmostEqual(
            report.max_drawdown, _reference_mdd(REAL_CLOSES, self.portfolio), places=2,
        )

    def test_historical_mode_does_not_add_estimation_warning(self):
        report = RiskEngine().check(
            self.portfolio, self.user, self.market, price_history=REAL_CLOSES,
        )
        self.assertFalse(any("简化估算" in w for w in report.warnings))

    def test_without_history_falls_back_and_warns(self):
        report = RiskEngine().check(self.portfolio, self.user, self.market)
        self.assertTrue(any("简化估算" in w for w in report.warnings))
        self.assertGreaterEqual(report.max_drawdown, 0.0)

    def test_avg_return_is_market_value_weighted(self):
        analyzer = PortfolioAnalyzer()
        report = analyzer.analyze(self.portfolio, self.market)
        mv_total = sum(p.market_value for p in self.portfolio.positions)
        expected = sum(
            p.market_value * p.return_pct for p in self.portfolio.positions
        ) / mv_total
        self.assertAlmostEqual(report.avg_return, expected, places=6)
        # 等权均值 ≠ 市值加权（夹具数据下两者不同，能验证确实是加权口径）
        equal_weight = sum(p.return_pct for p in self.portfolio.positions) / 3
        self.assertNotAlmostEqual(report.avg_return, equal_weight, places=2)


if __name__ == "__main__":
    unittest.main()
