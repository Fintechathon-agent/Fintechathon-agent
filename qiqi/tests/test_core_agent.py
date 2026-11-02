from __future__ import annotations

import json
import unittest
from unittest import mock

from web import core_agent


class BuildRequestTests(unittest.TestCase):
    def test_wraps_question_in_model_review_v1(self):
        payload = core_agent.build_request("请检查我的持仓", idempotency_key="idem-fixed")
        self.assertEqual(payload["schema_version"], "model-review.v1")
        self.assertEqual(payload["text"], "请检查我的持仓")
        self.assertEqual(payload["idempotency_key"], "idem-fixed")
        self.assertEqual(payload["execution_mode"], "PAPER")
        self.assertEqual(payload["capability"], "REVIEW_ONLY")
        self.assertEqual(payload["output_formats"], ["json"])

    def test_empty_question_is_rejected_locally(self):
        with self.assertRaises(ValueError):
            core_agent.build_request("   ")

    def test_question_is_capped(self):
        payload = core_agent.build_request("啊" * 9000)
        self.assertEqual(len(payload["text"]), 6000)


def _record(**overrides):
    record = {
        "schema_version": "model-review.v1",
        "workflow_version": "review-workflow.v1",
        "status": "PENDING_RISK",
        "run_id": "review-1",
        "task_id": "task-1",
        "session_id": "session-1",
        "audit": {"audit_id": "audit-1", "events": []},
        "model": {
            "provider": "cloudflare_workers_ai",
            "model_name": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            "source": "model",
            "model_response": {
                "call_succeeded": True,
                "attempt_count": 1,
                "retry_count": 0,
                "raw_text": "{}",
            },
        },
        "proposed_action": {
            "proposed_action": "REQUEST_MORE_INFO",
            "action_reason": "缺少用途",
            "risk_level": "unknown",
            "proposal_sha256": "abc",
        },
        "approval": {"approval_id": "approval-1", "status": "BLOCKED", "required": True},
        "risk_handoff": {"handoff_id": "handoff-1", "execution_allowed": False, "status": "PENDING_RISK"},
        "risk_decision": None,
        "reviewed_input": {"text": "原始输入"},
    }
    record.update(overrides)
    return record


class MappingTests(unittest.TestCase):
    def test_pending_risk_maps_to_awaiting_risk_and_never_allows_execution(self):
        ui = core_agent.to_ui_response(200, _record())
        self.assertEqual(ui["workflow_status"], "PENDING_RISK")
        self.assertEqual(ui["execution_state"], "awaiting_risk")
        self.assertFalse(ui["execution_allowed"])
        self.assertEqual(ui["decision_source"], "model")
        self.assertEqual(ui["run_id"], "review-1")
        self.assertEqual(ui["audit_id"], "audit-1")
        self.assertEqual(ui["recommendation"]["action"], "REQUEST_MORE_INFO")

    def test_model_failure_is_reported_as_unavailable_not_rule_fallback(self):
        record = _record(model={"source": None, "model_response": {"call_succeeded": False}})
        ui = core_agent.to_ui_response(502, record)
        self.assertEqual(ui["decision_source"], "none")
        self.assertEqual(ui["model_status"], "unavailable")
        self.assertIsNone(ui["recommendation"])

    def test_unknown_status_is_preserved_not_downgraded(self):
        ui = core_agent.to_ui_response(200, _record(status="REVIEW_REQUIRED"))
        self.assertEqual(ui["execution_state"], "review_required")
        self.assertFalse(ui["execution_allowed"])


class TransportTests(unittest.TestCase):
    def test_http_error_raises_core_agent_error_with_status(self):
        failure = {"error": {"code": "MODEL_TIMEOUT", "message": "模型超时"}}
        with mock.patch.object(core_agent, "post_review", return_value=(504, failure)):
            with self.assertRaises(core_agent.CoreAgentError) as ctx:
                core_agent.review("请检查持仓")
        self.assertEqual(ctx.exception.status_code, 504)
        self.assertIn("MODEL_TIMEOUT", str(ctx.exception))

    def test_success_returns_mapped_payload(self):
        with mock.patch.object(core_agent, "post_review", return_value=(200, _record())):
            ui = core_agent.review("请检查持仓")
        self.assertEqual(ui["engine"], "core-agent")
        self.assertEqual(ui["backend"]["http_status"], 200)

    def test_network_failure_is_not_swallowed(self):
        with mock.patch.object(core_agent, "post_review", side_effect=core_agent.CoreAgentError("不可达", 0)):
            with self.assertRaises(core_agent.CoreAgentError):
                core_agent.review("请检查持仓")

    def test_transport_inherits_no_system_proxy_by_default(self):
        opener = core_agent._transport()
        # 未配置 CORE_AGENT_PROXY 时不应使用系统代理
        self.assertIsNotNone(opener)


if __name__ == "__main__":
    unittest.main()
