from __future__ import annotations

import unittest

from web.banking_demo import get_banking_state
from web.banking_service import (
    confirm_action, pending_list, run_scenario, scenario_overview, seed_demo_queue,
)


class BankingServiceFlowTests(unittest.TestCase):
    def setUp(self):
        self.state = get_banking_state()
        self.state.reset()

    def tearDown(self):
        self.state.reset()

    def test_cross_scene_funding_confirmation_is_queued_and_consumed(self):
        result = run_scenario("我爱人10月25日生日，锁定1000元活期")
        self.assertEqual(result["result"]["status"], "pending_confirmation")
        self.assertEqual(result["pending"][-1]["scenario"], "cross_scene")
        repeated_request = run_scenario("我爱人10月25日生日，锁定1000元活期")
        self.assertTrue(repeated_request["deduplicated"])
        self.assertEqual(len(repeated_request["pending"]), 1)
        confirmed = confirm_action({"id": result["pending"][-1]["id"]})
        self.assertTrue(confirmed["success"])
        self.assertEqual(confirmed["pending"], [])
        repeated = confirm_action({"id": result["pending"][-1]["id"]})
        self.assertFalse(repeated["success"])

    def test_card_limit_is_applied_after_confirmation(self):
        result = run_scenario("尾号8888的卡额度调到2万")
        self.assertEqual(result["result"]["status"], "pending_confirmation")
        confirmed = confirm_action({"id": result["pending"][-1]["id"]})
        self.assertTrue(confirmed["success"])
        card = next(c for c in self.state.cards if c.last4 == "8888")
        self.assertEqual(card.credit_limit, 20_000.0)

    def test_duplicate_pending_request_is_collapsed_and_marked(self):
        first = run_scenario("给王芳转500元备注聚餐")
        second = run_scenario("给王芳转500元备注聚餐")
        self.assertFalse(first["deduplicated"])
        self.assertTrue(second["deduplicated"])
        self.assertEqual(len(second["pending"]), 1)

    def test_expired_pending_cannot_be_confirmed(self):
        result = run_scenario("给王芳转500元备注聚餐")
        pending_id = result["pending"][-1]["id"]
        self.state.pending[-1]["expires_at"] = "2000-01-01T00:00:00"
        self.state.save()
        self.assertEqual(pending_list(), [])
        expired = confirm_action({"id": pending_id})
        self.assertFalse(expired["success"])
        self.assertIn("过期", expired["message"])

    def test_demo_provenance_is_present_on_overview_and_result(self):
        overview = scenario_overview()
        result = run_scenario("这个月账单分析")
        self.assertEqual(overview["provenance"]["source"], "demo_fixture")
        self.assertEqual(result["provenance"]["source_label"], "演示固定数据")
        self.assertIn("不会发生真实", result["provenance"]["simulation_notice"])


class SeedDemoQueueTests(unittest.TestCase):
    """第三版任务台「预置演示数据」：队列与审计基线都真实走规则引擎。"""

    def setUp(self):
        self.state = get_banking_state()
        self.state.reset()

    def tearDown(self):
        self.state.reset()

    def test_seed_creates_five_flagged_pending_items(self):
        result = seed_demo_queue()
        self.assertTrue(result["seeded"])
        pending = result["pending"]
        self.assertEqual(len(pending), 5)
        self.assertTrue(all(p.get("seeded") for p in pending))
        self.assertEqual(len([p for p in pending if p["tier"] == "red"]), 2)
        self.assertEqual(len([p for p in pending if p["tier"] == "yellow"]), 3)
        self.assertTrue(self.state.demo_seeded)

    def test_seed_is_noop_when_queue_already_busy(self):
        first = seed_demo_queue()
        second = seed_demo_queue()
        self.assertFalse(second["seeded"])
        self.assertEqual(len(second["pending"]), len(first["pending"]))

    def test_seeded_item_confirms_and_is_consumed(self):
        seed_demo_queue()
        yellow = next(p for p in pending_list() if p["tier"] == "yellow")
        confirmed = confirm_action({"id": yellow["id"]})
        self.assertTrue(confirmed["success"])
        self.assertEqual(len(confirmed["pending"]), 4)

    def test_reset_keeps_queue_empty_and_marks_seeded(self):
        seed_demo_queue()
        self.state.reset()
        self.assertEqual(pending_list(), [])
        self.assertTrue(self.state.demo_seeded)


if __name__ == "__main__":
    unittest.main()
