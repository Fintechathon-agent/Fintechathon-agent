from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent.tools import fund_ops
from agent.tools.fund_ops import (
    is_exchange_fund, is_otc_fund, otc_redeem, otc_subscribe,
)
from agent.tools.paper_trade import PaperTradingTool
from contracts.types import ActionType, Recommendation


def _rec(action: ActionType, symbol: str, quantity: float, price: float) -> Recommendation:
    return Recommendation(
        action=action, symbol=symbol, quantity=quantity, price=price,
        reason="", evidence=[], confidence=0.8, risk_impact="", alternative="",
    )


class FundOpsMathTests(unittest.TestCase):
    """基金申赎按标准公式手工对账。"""

    def test_subscribe_net_amount_and_shares(self):
        # 申购 10000 元，净值 1.5，申购费 0.15%：
        # 净申购金额 = 10000 / 1.0015 = 9985.02…；申购费 14.98；份额 = 净额/净值
        res = otc_subscribe(10000.0, 1.5)
        self.assertAlmostEqual(res.fee, 14.98, places=2)
        self.assertAlmostEqual(res.net_amount, 9985.02, places=2)
        self.assertAlmostEqual(res.shares, 6656.68, places=2)

    def test_redeem_fee_tiers(self):
        # 份额 6656.68，净值 1.6：赎回总额 10650.69
        cases = [
            (3, 0.015),    # <7 天：1.5%
            (10, 0.005),   # 7-30 天：0.5%
            (60, 0.0025),  # 30-365 天：0.25%
            (400, 0.0),    # ≥365 天：免
        ]
        for days, rate in cases:
            res = otc_redeem(6656.68, 1.6, days)
            self.assertAlmostEqual(res.fee_rate, rate, places=4)
            expected_fee = 10650.688 * rate
            self.assertAlmostEqual(res.fee, expected_fee, places=2)
            self.assertAlmostEqual(res.net_amount, 10650.688 - expected_fee, places=2)

    def test_symbol_detection(self):
        self.assertTrue(is_exchange_fund("510300"))
        self.assertTrue(is_exchange_fund("159915"))
        self.assertFalse(is_exchange_fund("600519"))
        self.assertTrue(is_otc_fund("000001.OF"))
        self.assertFalse(is_otc_fund("000001"))


class PaperTradeAssetTests(unittest.TestCase):
    """纸交易按标的类型分流：ETF 免印花税、场外基金按申赎模型。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tool = PaperTradingTool(storage_dir=Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_etf_sell_has_no_stamp_duty(self):
        # 场内 ETF（510300）卖出：只收佣金万三，无印花税
        with mock.patch("random.uniform", return_value=0.0):
            rec = _rec(ActionType.SELL, "510300", 1000, 4.0)
            record = self.tool._do_trade(rec, "s1")
        amount = 4.0 * 1000
        self.assertAlmostEqual(record.commission, amount * 0.0003, places=2)

    def test_stock_sell_includes_stamp_duty(self):
        with mock.patch("random.uniform", return_value=0.0):
            rec = _rec(ActionType.SELL, "600519", 100, 1274.89)
            record = self.tool._do_trade(rec, "s1")
        amount = 1274.89 * 100
        self.assertAlmostEqual(record.commission, amount * 0.0008, places=2)

    def test_otc_fund_subscribe_and_redeem(self):
        # 场外基金：申购 10000 元（净值 1.5）→ 份额 6656.68；随即赎回 → <7 天 1.5% 档
        with mock.patch("random.uniform", return_value=0.0):
            buy = self.tool.execute(_rec(ActionType.BUY, "000001.OF", 10000.0, 1.5), "s1")
        self.assertTrue(buy.success)
        record = buy.trade_record
        self.assertEqual(record.action, "申购")
        self.assertAlmostEqual(record.commission, 14.98, places=2)  # 申购费
        positions = self.tool.get_positions("s1")
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0].asset_type, "fund")
        self.assertAlmostEqual(positions[0].quantity, 6656.68, places=2)

        with mock.patch("random.uniform", return_value=0.0):
            sell = self.tool.execute(
                _rec(ActionType.SELL, "000001.OF", 6656.68, 1.6), "s1",
            )
        self.assertTrue(sell.success)
        self.assertEqual(sell.trade_record.action, "赎回")
        # 当日赎回：持有 0 天 → 1.5% 档；到账 = 6656.68*1.6*(1-0.015)
        expected_net = 6656.68 * 1.6 * (1 - 0.015)
        self.assertAlmostEqual(sell.trade_record.amount, expected_net, places=2)


if __name__ == "__main__":
    unittest.main()
