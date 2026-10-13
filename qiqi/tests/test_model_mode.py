from __future__ import annotations

import unittest
from types import SimpleNamespace

from agent.orchestrator.orchestrator import DecisionMaker, ModelDecisionError
from contracts.types import (
    ActionType, Portfolio, Position, Recommendation, RiskReport, UserProfile,
)


class _FakeLLM:
    """模拟 LLMClient：可配置成功/失败行为。"""

    def __init__(self, fail: bool = False):
        self.fail = fail

    def chat_json(self, system: str, user: str) -> dict:
        if self.fail:
            raise TimeoutError("fake timeout")
        return {
            "recommendation": {
                "action": "持有",
                "symbol": "600519",
                "quantity": 0,
                "price": 1500.0,
                "reason": "测试：数据充分，维持现状",
                "evidence": ["测试证据"],
                "confidence": 0.8,
                "risk_impact": "低",
                "alternative": "无",
            },
            "reasoning": "测试推理",
        }


def _ctx() -> SimpleNamespace:
    portfolio = Portfolio(
        user_id="u1",
        date="2026-10-13",
        positions=[
            Position(
                symbol="600519", name="贵州茅台", quantity=100, avg_cost=1400.0,
                current_price=1500.0, market_value=150000.0, return_pct=7.14,
                sector="食品饮料",
            ),
        ],
        total_value=150000.0,
        cash=10000.0,
    )
    return SimpleNamespace(
        portfolio=portfolio,
        user_question="请检查我的持仓健康状况",
        build_llm_context=lambda: "ctx",
        user_profile=UserProfile(user_id="u1", name="测试用户", max_single_loss=0.05),
    )


def _risk() -> RiskReport:
    return RiskReport(
        portfolio_id="p1",
        generated_at="2026-10-13T12:00:00",
        risk_score=30.0,
        var_95=12.0,
        max_drawdown=15.0,
        warnings=[],
    )


class ModelModeTests(unittest.TestCase):
    """演示模式 vs 真实模型联调模式：失败行为必须不同。"""

    def test_demo_mode_llm_failure_falls_back_to_rules_with_source(self):
        dm = DecisionMaker(_FakeLLM(fail=True), strict_live=False)
        rec = dm.decide(_ctx(), _risk())      # type: ignore[arg-type]
        self.assertIsInstance(rec, Recommendation)
        self.assertEqual(dm.last_source, "rules")
        self.assertTrue(dm.last_model_error)

    def test_demo_mode_llm_success_marks_source_llm_and_keeps_raw(self):
        dm = DecisionMaker(_FakeLLM(fail=False), strict_live=False)
        dm.decide(_ctx(), _risk())            # type: ignore[arg-type]
        self.assertEqual(dm.last_source, "llm")
        self.assertEqual(dm.last_model_error, "")
        self.assertTrue(dm.last_raw.get("recommendation"))

    def test_live_mode_llm_failure_raises_and_never_falls_back(self):
        dm = DecisionMaker(_FakeLLM(fail=True), strict_live=True)
        with self.assertRaises(ModelDecisionError):
            dm.decide(_ctx(), _risk())        # type: ignore[arg-type]
        self.assertEqual(dm.last_source, "")   # 无来源 = 本轮失败，上游据此返回错误信封

    def test_live_mode_without_llm_falls_back_to_rules(self):
        # 无 Key 的联调环境：DecisionMaker 仍可用规则决策，
        # 由 Web 层 model_status="not_configured" 明确标注（而非假装模型成功）。
        dm = DecisionMaker(None, strict_live=True)
        rec = dm.decide(_ctx(), _risk())      # type: ignore[arg-type]
        self.assertIsInstance(rec, Recommendation)
        self.assertEqual(dm.last_source, "rules")

    def test_action_hold_kept_when_llm_omits_action(self):
        dm = DecisionMaker(_FakeLLM(fail=False), strict_live=False)
        rec = dm.decide(_ctx(), _risk())      # type: ignore[arg-type]
        self.assertEqual(rec.action, ActionType.HOLD)


if __name__ == "__main__":
    unittest.main()
