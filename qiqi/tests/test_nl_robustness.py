"""自然语言入口鲁棒性回归测试（2026-10-12 自我否决机制落地）。

背景：黑盒验证发现最自然的用户表达大量误路由（「这个月花了多少钱」被当理财、
「查余额」「看看我的卡」无能力、「取消自动续费」不追问等）。本文件把这些
真实用户语句固化为回归用例，防止修复回退。

用例只断言场景路由/权限级别/关键槽位，不依赖 LLM key。
"""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from agent.banking.router import route
from agent.banking import detect_scenario
from agent.core.intent import parse_intent
from contracts.types import Portfolio, Position
from web.banking_demo import demo_bills, demo_cards, demo_contacts, demo_balance


def _portfolio() -> Portfolio:
    return Portfolio(
        user_id="u1", date="2026-10-12",
        positions=[
            Position(symbol="000001", name="平安银行", quantity=5000, avg_cost=9.0,
                     current_price=10.31, market_value=51550.0, return_pct=14.6,
                     sector="银行"),
            Position(symbol="600519", name="贵州茅台", quantity=100, avg_cost=1700.0,
                     current_price=1650.0, market_value=165000.0, return_pct=-2.9,
                     sector="白酒"),
        ],
        total_value=216550.0, cash=50000.0,
    )


def _route(text: str):
    return route(
        text,
        bills_data=demo_bills(),
        cards_data=demo_cards(),
        contacts=demo_contacts(),
        balance=demo_balance(),
    )


class BillPhrasingTests(unittest.TestCase):
    """账单分析：最自然的口语问法必须命中账单场景。"""

    def test_how_much_spent_this_month(self):
        r = _route("帮我看看这个月花了多少钱")
        self.assertEqual(r.scenario, "bill")
        self.assertEqual(r.tier, "green")

    def test_how_much_spent_last_month(self):
        r = _route("上个月花了多少")
        self.assertEqual(r.scenario, "bill")
        self.assertRegex(r.data["period"], r"^\d{4}-\d{2}$")

    def test_expense_phrasing(self):
        for text in ("这个月开销", "本月花费", "我的开支情况"):
            self.assertEqual(detect_scenario(text), "bill", text)


class BalanceQueryTests(unittest.TestCase):
    """余额查询：赛题绿色查询类，应确定性回答而非转交理财。"""

    def test_balance_query(self):
        r = _route("查一下我的余额")
        self.assertEqual(r.scenario, "transfer")
        self.assertEqual(r.tier, "green")
        self.assertEqual(r.status, "done")
        self.assertTrue(r.data.get("balance_query"))
        self.assertIn("余额", r.message)

    def test_balance_phrase_with_action_not_hijacked(self):
        # 含转账动作的句子不能被余额查询劫持
        r = _route("余额够的话转500给陈大黄")
        self.assertEqual(r.scenario, "transfer")


class CardTests(unittest.TestCase):
    def test_card_list_query(self):
        r = _route("帮我看看我的银行卡")
        self.assertEqual(r.scenario, "card")
        self.assertEqual(r.tier, "green")
        self.assertEqual(r.status, "executed")
        self.assertEqual(len(r.data.get("cards", [])), 5)

    def test_card_action_without_identifier_clarifies(self):
        r = _route("信用卡额度调到2万")
        self.assertEqual(r.scenario, "card")
        self.assertEqual(r.status, "needs_clarification")
        self.assertIn("尾号", r.message)

    def test_card_limit_adjust_with_tail_carries_new_limit(self):
        r = _route("尾号8888的卡额度调到2万")
        self.assertEqual(r.status, "pending_confirmation")
        self.assertEqual(r.tier, "yellow")
        self.assertEqual(r.data.get("new_limit"), 20000.0)

    def test_unknown_card_still_blocked(self):
        # 给了尾号但匹配不到 → 仍走确定性闸门拦截（安全行为不回退）
        r = _route("尾号9999的卡挂失")
        self.assertEqual(r.status, "blocked")


class TransferTests(unittest.TestCase):
    def test_payee_regex_does_not_eat_zhuan(self):
        r = _route("给小李转200块")
        self.assertEqual(r.status, "blocked")  # 小李不在通讯录，按设计拦截
        self.assertIn("小李", r.message)
        self.assertNotIn("小李转", r.message)


class SubscriptionTests(unittest.TestCase):
    def test_cancel_without_merchant_clarifies(self):
        r = _route("取消自动续费")
        self.assertEqual(r.scenario, "subscription")
        self.assertEqual(r.status, "needs_clarification")
        self.assertIn("哪一个", r.message)

    def test_cancel_with_merchant_still_works(self):
        r = _route("取消健身房会员")
        self.assertEqual(r.status, "pending_confirmation")
        self.assertEqual(r.tier, "yellow")


class CrossSceneTests(unittest.TestCase):
    def test_relative_date_tomorrow(self):
        r = _route("妈妈明天过生日帮我订个蛋糕")
        self.assertEqual(r.scenario, "cross_scene")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        self.assertEqual(r.intent["slots"]["birthday"], tomorrow)
        steps = [s["id"] for s in r.data["plan"]["steps"]]
        self.assertIn("order_cake", steps)

    def test_explicit_date_still_works(self):
        r = _route("我爱人10月25日生日，生日前2天订花和蛋糕，锁定1000元活期")
        self.assertEqual(r.scenario, "cross_scene")
        birthday = datetime.fromisoformat(r.intent["slots"]["birthday"])
        self.assertEqual((birthday.month, birthday.day), (10, 25))
        self.assertGreaterEqual(birthday.date(), datetime.now().date())


class WealthVerbTests(unittest.TestCase):
    """理财深度分析动词对齐赛题：申购/赎回/推荐/风险评估。"""

    def test_shengou_is_buy(self):
        intent = parse_intent("申购平安银行 5000元", _portfolio())
        self.assertEqual(intent.name, "execute")
        self.assertEqual(intent.direction, "buy")

    def test_shuhui_is_sell(self):
        intent = parse_intent("赎回平安银行 30%", _portfolio())
        self.assertEqual(intent.name, "execute")
        self.assertEqual(intent.direction, "sell")

    def test_recommend_is_advise(self):
        intent = parse_intent("帮我推荐一只基金", _portfolio())
        self.assertEqual(intent.name, "advise")

    def test_risk_assessment_is_diagnose(self):
        intent = parse_intent("帮我做一次风险评估", _portfolio())
        self.assertEqual(intent.name, "diagnose")


if __name__ == "__main__":
    unittest.main()
