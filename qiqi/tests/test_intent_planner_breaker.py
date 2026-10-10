from __future__ import annotations

import tempfile
import unittest

from agent.core.intent import parse_intent
from agent.core.loop import AgentLoop
from agent.core.memory import MemoryStore
from agent.core.planner import build_plan
from agent.core.session import SessionManager
from agent.orchestrator.orchestrator import DecisionMaker
from agent.risk.circuit_breaker import CircuitBreaker
from agent.risk.circuit_breaker import init_breaker
from agent.risk.audit import AuditLogger
from contracts.types import (
    ActionType,
    Context,
    GateResult,
    MarketData,
    MarketSnapshot,
    Recommendation,
    RiskReport,
)
from demo import create_demo_portfolio, create_demo_user
from evals.run_safety_eval import evaluate


class IntentPlannerTests(unittest.TestCase):
    def setUp(self):
        self.portfolio = create_demo_portfolio()

    def test_diagnose_natural_language(self):
        result = parse_intent("平安银行是不是该跑了？帮我看看", self.portfolio)
        self.assertEqual(result.name, "advise")
        self.assertEqual(result.slots["symbol"], "000001")

    def test_execute_extracts_symbol_and_ratio(self):
        result = parse_intent("把平安银行卖出 30%", self.portfolio)
        self.assertTrue(result.is_executable)
        self.assertEqual(result.direction, "sell")
        self.assertEqual(result.symbols, ["000001"])
        self.assertAlmostEqual(result.sell_ratio, 0.3)

    def test_execute_missing_target_asks_clarification(self):
        result = parse_intent("帮我减仓 20%", self.portfolio)
        self.assertEqual(result.name, "execute")
        self.assertIn("标的", result.missing)
        self.assertFalse(result.is_executable)

    def test_vague_request_does_not_delegate_decision(self):
        result = parse_intent("你定吧", self.portfolio)
        self.assertEqual(result.name, "insufficient")
        self.assertIn("不能替你决定", result.message)

    def test_out_of_scope_request_is_explicit(self):
        result = parse_intent("帮我订一张机票", self.portfolio)
        self.assertEqual(result.name, "out_of_scope")

    def test_diagnose_and_execute_have_different_dags(self):
        diagnose = build_plan(parse_intent("检查持仓", self.portfolio))
        execute = build_plan(parse_intent("平安银行卖出 30%", self.portfolio))
        self.assertEqual(diagnose.nodes[-1].id, "respond")
        self.assertEqual(execute.nodes[-1].id, "approval")
        self.assertEqual(execute.nodes[-1].depends_on, ["simulate", "gate"])

    def test_clarification_does_not_call_tools(self):
        plan = build_plan(parse_intent("你定吧", self.portfolio))
        self.assertEqual([node.id for node in plan.nodes], ["validate"])

    def test_rule_decision_consumes_explicit_sell_request(self):
        portfolio = self.portfolio
        ctx = Context(
            user_profile=create_demo_user(),
            portfolio=portfolio,
            user_question="平安银行卖出 30%",
        )
        report = RiskReport(portfolio_id="p1", generated_at="now")
        recommendation = DecisionMaker().decide(ctx, report)
        self.assertEqual(recommendation.action, ActionType.SELL)
        self.assertEqual(recommendation.symbol, "000001")
        self.assertEqual(recommendation.quantity, 1500)


class CircuitBreakerTests(unittest.TestCase):
    def test_three_failures_lock_and_manual_reset_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            breaker = CircuitBreaker(tmp, threshold=3)
            breaker.record_failure("gate_block")
            breaker.record_failure("memory_write_rejected")
            self.assertFalse(breaker.is_locked())
            breaker.record_failure("strong_verify_failed")
            self.assertTrue(breaker.is_locked())
            breaker.reset("test human confirmation")
            self.assertFalse(breaker.is_locked())

    def test_clean_run_resets_unlocked_failure_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            breaker = CircuitBreaker(tmp, threshold=3)
            breaker.record_failure("gate_block")
            self.assertEqual(breaker.state()["consecutive_failures"], 1)
            breaker.record_ok()
            self.assertEqual(breaker.state()["consecutive_failures"], 0)

    def test_lock_survives_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            breaker = CircuitBreaker(tmp, threshold=1)
            breaker.record_failure("loop_error")
            self.assertTrue(CircuitBreaker(tmp, threshold=1).is_locked())


class SafetyEvalTests(unittest.TestCase):
    def test_fifty_attacks_are_blocked_without_benign_false_positives(self):
        result = evaluate()
        self.assertEqual(result["attack_count"], 50)
        self.assertEqual(result["interception_rate"], 1.0)
        self.assertEqual(result["false_positive_rate"], 0.0)


class AgentLoopPermissionTests(unittest.TestCase):
    def _run(self, recommendation: Recommendation):
        portfolio = create_demo_portfolio()
        user = create_demo_user()
        called = {"paper": False}
        with tempfile.TemporaryDirectory() as tmp:
            init_breaker(tmp)
            loop = AgentLoop(
                market_fetcher=lambda symbols: MarketSnapshot(
                    timestamp="now",
                    data={
                        p.symbol: MarketData(
                            timestamp="now", symbol=p.symbol, name=p.name,
                            price=p.current_price, source="test",
                        ) for p in portfolio.positions
                    },
                ),
                news_fetcher=lambda symbol: [],
                portfolio_analyzer=lambda pf, market: {"reasoning": "ok", "next_actions": []},
                risk_engine=lambda pf, profile, market: RiskReport(
                    portfolio_id="p1", generated_at="now",
                ),
                decision_maker=lambda ctx, report: recommendation,
                paper_trader=lambda rec, sid: called.update(paper=True) or {"success": True},
                memory_store=MemoryStore(f"{tmp}/memory"),
                session_manager=SessionManager(),
                risk_gate=lambda rec, pf, profile, market: GateResult(passed=True),
                audit_logger=AuditLogger(f"{tmp}/audit"),
            )
            response = loop.run(user.user_id, portfolio, user, "检查我的持仓")
        return response, called

    def test_financial_action_always_requires_human_approval(self):
        response, called = self._run(Recommendation(
            action=ActionType.SELL, symbol="000001", quantity=100,
            price=10.5, reason="test", confidence=0.99,
        ))
        self.assertTrue(response.requires_approval)
        self.assertIsNotNone(response.approval_request)
        self.assertFalse(response.executed)
        self.assertFalse(called["paper"])

    def test_hold_does_not_create_trade_side_effect(self):
        response, called = self._run(Recommendation(
            action=ActionType.HOLD, symbol="", quantity=0,
            price=0, reason="test", confidence=0.99,
        ))
        self.assertFalse(response.requires_approval)
        self.assertFalse(response.executed)
        self.assertFalse(called["paper"])


if __name__ == "__main__":
    unittest.main()
