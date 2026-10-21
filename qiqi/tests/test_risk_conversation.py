"""No-network tests for the opt-in daily-finance conversation proxy."""
from __future__ import annotations

import io
import json
import os
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import Mock, patch

from web import risk_conversation as conversation

ENV = {"RISK_CONVERSATION_BASE_URL": "http://127.0.0.1:8790",
       "RISK_CONVERSATION_API_KEY": "test-only-conversation-key-32chars"}


def valid_response():
    return {"engine": "risk-conversation", "decision_source": "model", "model_status": "live",
            "execution_allowed": False, "queued": False, "executed": False,
            "risk_advice": {"decision": "BLOCK", "program_generated": True, "execution_allowed": False,
                            "metrics": {"free_before_minor": 600000}, "reasons": []},
            "run_id": "core-run-original", "task_id": "core-task-original", "audit_id": "core-audit-original",
            "model_raw": "Actual model explanation", "execution_state": "blocked"}


def response(data, status=200):
    stream = io.BytesIO(json.dumps(data, ensure_ascii=False).encode())
    stream.status = status
    return stream


class ConfigurationTests(unittest.TestCase):
    def test_config_status_only_returns_boolean(self):
        with patch.dict(os.environ, ENV, clear=True):
            self.assertIs(conversation.configured(), True)
        with patch.dict(os.environ, {}, clear=True):
            self.assertIs(conversation.configured(), False)
            self.assertFalse(conversation.requested({"question": "test"}))
            self.assertTrue(conversation.requested({"daily_finance_yuan": None}))
            self.assertTrue(conversation.requested({"daily_finance": None}))

    def test_partial_config_never_selects_legacy(self):
        for env in ({"RISK_CONVERSATION_BASE_URL": ENV["RISK_CONVERSATION_BASE_URL"]},
                    {"RISK_CONVERSATION_API_KEY": ENV["RISK_CONVERSATION_API_KEY"]}):
            with self.subTest(env=list(env)), patch.dict(os.environ, env, clear=True):
                self.assertTrue(conversation.requested({"question": "test"}))
                self.assertFalse(conversation.configured())

    def test_short_key_cannot_enable_service(self):
        with patch.dict(os.environ, {**ENV, "RISK_CONVERSATION_API_KEY": "short-key"}, clear=True):
            self.assertFalse(conversation.configured())

    def test_only_https_or_loopback_http_origins(self):
        for url in ("https://team.example", "http://localhost:8790", "http://127.0.0.1:8790", "http://[::1]:8790/"):
            with self.subTest(url=url), patch.dict(os.environ, {**ENV, "RISK_CONVERSATION_BASE_URL": url}, clear=True):
                self.assertTrue(conversation.configured())
        for url in ("http://team.example", "https://user:pass@team.example", "https://team.example/path",
                    "https://team.example?key=x", "https://team.example#fragment", "file:///tmp/service", "https://team.example:invalid"):
            with self.subTest(url=url), patch.dict(os.environ, {**ENV, "RISK_CONVERSATION_BASE_URL": url}, clear=True):
                self.assertFalse(conversation.configured())


class ValidationTests(unittest.TestCase):
    def test_exact_yuan_strings_and_null_survive(self):
        data = conversation.validate_request({"question": "  房租会受影响吗？  ", "daily_finance_yuan": {
            "cash_yuan": "10000.01", "amount_yuan": "8000", "fees_yuan": "0",
            "purpose_label": "房租", "purpose_yuan": "3000", "due_date": "2026-11-01",
            "facts_confirmed": True, "purpose_confirmed": False}})
        self.assertEqual(data["question"], "房租会受影响吗？")
        finance = data["daily_finance_yuan"]
        self.assertEqual(finance["cash_yuan"], "10000.01")
        self.assertEqual(finance["fees_yuan"], "0")
        self.assertIsNone(finance["holds_yuan"])
        self.assertIsNone(finance["floor_yuan"])
        self.assertFalse(finance["purpose_confirmed"])

    def test_rejects_rounding_coercion_and_nonfinite_amounts(self):
        for amount in ("0.001", "-1", "1e3", "1,000", "01", "", "NaN", 0, 3.14, True, "10000000000.01"):
            with self.subTest(amount=amount), self.assertRaises(conversation.ConversationError):
                conversation.validate_request({"question": "核对", "daily_finance_yuan": {"cash_yuan": amount}})

    def test_question_not_truncated_and_privilege_fields_rejected(self):
        self.assertEqual(len(conversation.validate_request({"question": "问" * 20000})["question"]), 20000)
        for data in ({"question": "问" * 20001}, {"question": "问", "user_id": "other"},
                     {"question": "问", "risk": "ALLOW"}, {"question": "问", "approval": "APPROVED"},
                     {"question": "问", "daily_finance_yuan": {"purpose_confirmed": "true"}},
                     {"question": "问", "daily_finance_yuan": {"user_id": "other"}},
                     {"question": "问", "daily_finance_yuan": {"due_date": "2026-02-30"}},
                     {"question": "问", "idempotency_key": "bad key"}):
            with self.subTest(data=str(data)[:100]), self.assertRaises(conversation.ConversationError):
                conversation.validate_request(data)


class ProxyTests(unittest.TestCase):
    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.urllib.request.build_opener")
    def test_uses_server_key_and_original_trace_without_execution(self, build):
        build.return_value.open.return_value = response(valid_response())
        status, data = conversation.review({"question": "核对房租", "daily_finance_yuan": {"cash_yuan": "10000.01"}})
        sent = build.return_value.open.call_args.args[0]
        self.assertEqual(sent.full_url, "http://127.0.0.1:8790/api/review")
        self.assertEqual(sent.get_header("X-risk-conversation-key"), ENV["RISK_CONVERSATION_API_KEY"])
        self.assertEqual(json.loads(sent.data)["daily_finance_yuan"]["cash_yuan"], "10000.01")
        self.assertRegex(json.loads(sent.data)["idempotency_key"], r"^conversation-[a-f0-9-]{36}$")
        self.assertEqual(status, 200)
        self.assertEqual(data["task_id"], "core-task-original")
        self.assertEqual(data["model_raw"], "Actual model explanation")
        self.assertEqual(data["conversation_mode"], "READ_ONLY_CONVERSATION")
        self.assertFalse(data["queued"])
        self.assertFalse(data["executed"])
        self.assertIsNone(data["approval_id"])
        self.assertNotIn(ENV["RISK_CONVERSATION_API_KEY"], json.dumps(data))

    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.urllib.request.build_opener")
    def test_existing_idempotency_key_is_preserved(self, build):
        build.return_value.open.return_value = response(valid_response())
        conversation.review({"question": "核对", "idempotency_key": "original-request-123456"})
        sent = build.return_value.open.call_args.args[0]
        self.assertEqual(json.loads(sent.data)["idempotency_key"], "original-request-123456")

    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.urllib.request.build_opener")
    def test_backend_failure_is_not_converted_to_success(self, build):
        failure = {"error": "model unavailable", "execution_allowed": False, "decision_source": "unavailable"}
        build.return_value.open.side_effect = urllib.error.HTTPError("http://localhost/api/review", 503, "unavailable", {}, response(failure))
        status, data = conversation.review({"question": "核对"})
        self.assertEqual(status, 503)
        self.assertEqual(data["error"], "model unavailable")
        self.assertEqual(data["decision_source"], "unavailable")
        self.assertFalse(data["executed"])

    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.urllib.request.build_opener")
    def test_network_failure_and_redirect_fail_closed(self, build):
        for error in (urllib.error.URLError("offline"), TimeoutError("timeout"),
                      urllib.error.HTTPError("http://localhost/api/review", 302, "redirect", {"Location": "https://other.example"}, io.BytesIO())):
            with self.subTest(error=type(error).__name__), self.assertRaises(conversation.ConversationError) as caught:
                build.return_value.open.side_effect = error
                conversation.review({"question": "核对"})
            self.assertFalse(caught.exception.payload()["execution_allowed"])

    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.urllib.request.build_opener")
    def test_invalid_json_and_upstream_authorization_claims_rejected(self, build):
        for change in ({"queued": True}, {"execution_allowed": True}, {"executed": True},
                       {"decision_source": "rules"}, {"risk_advice": {"decision": "ALLOW", "program_generated": False}},
                       {"risk_advice": None}):
            with self.subTest(change=change), self.assertRaises(conversation.ConversationError):
                build.return_value.open.return_value = response({**valid_response(), **change})
                conversation.review({"question": "核对"})
        build.return_value.open.return_value = response(["invalid object"])
        with self.assertRaises(conversation.ConversationError):
            conversation.review({"question": "核对"})


class ExistingEntryTests(unittest.TestCase):
    def setUp(self):
        from web.app import Handler
        self.handler = Handler

    def post(self, body):
        fake = SimpleNamespace(path="/api/review", _body_json=Mock(return_value=body),
                               _json=Mock(), _error=Mock(), app=SimpleNamespace(review=Mock(return_value={"old": True})))
        self.handler.do_POST(fake)
        return fake

    @patch.dict(os.environ, {}, clear=True)
    def test_unconfigured_normal_review_keeps_legacy_entry(self):
        fake = self.post({"question": "检查持仓"})
        fake.app.review.assert_called_once_with("检查持仓")
        fake._json.assert_called_once_with({"old": True})

    @patch.dict(os.environ, {}, clear=True)
    def test_unconfigured_daily_finance_cannot_fall_back(self):
        fake = self.post({"question": "核对房租", "daily_finance_yuan": {"cash_yuan": "10000"}})
        fake.app.review.assert_not_called()
        payload, status = fake._json.call_args.args
        self.assertEqual(status, 503)
        self.assertEqual(payload["decision_source"], "unavailable")
        self.assertFalse(payload["execution_allowed"])

    @patch.dict(os.environ, ENV, clear=True)
    @patch("web.risk_conversation.review", return_value=(200, {"adapter": True}))
    def test_configured_existing_review_forwards_and_never_calls_old_model(self, review):
        fake = self.post({"question": "核对房租"})
        review.assert_called_once_with({"question": "核对房租"})
        fake.app.review.assert_not_called()
        fake._json.assert_called_once_with({"adapter": True}, 200)

    @patch.dict(os.environ, ENV, clear=True)
    def test_status_does_not_disclose_upstream_or_key(self):
        fake = SimpleNamespace(path="/api/risk-conversation/status", _json=Mock(), _error=Mock())
        self.handler.do_GET(fake)
        fake._json.assert_called_once_with({"configured": True})


if __name__ == "__main__":
    unittest.main()
