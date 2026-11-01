"""Local Personal AI Fund Manager → Finance → Risk → Core HTTP acceptance."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[2]


class PersonalJointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.process = subprocess.Popen(
            [sys.executable, "-u", str(ROOT / "qiqi/web/guest_gateway.py"),
             "--port", "0", "--frontend", "personal", "--joint-core-risk"],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            try:
                line = pool.submit(cls.process.stdout.readline).result(timeout=25)
                cls.origin = json.loads(line)["url"].rstrip("/")
            except Exception:
                cls.process.terminate()
                cls.process.wait(timeout=5)
                raise RuntimeError("Local joint gateway did not start") from None

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=15)
        cls.process.stdout.close()
        cls.process.stderr.close()

    def browser(self):
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar()),
            urllib.request.ProxyHandler({}),
        )
        with opener.open(self.origin + "/", timeout=20) as response:
            self.assertIn(b"Personal AI Fund Manager", response.read())
        return opener

    def call(self, opener, route, body=None):
        request = urllib.request.Request(self.origin + route,
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
            headers={"Content-Type": "application/json"} if body is not None else {},
            method="POST" if body is not None else "GET")
        try:
            response = opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_same_task_replay_and_account_snapshot(self):
        browser = self.browser()
        status, state = self.call(browser, "/api/personal-fund/status")
        self.assertEqual(status, 200)
        self.assertEqual(state["core_risk"], "LOCAL_SYNTHETIC_JOINT")
        self.assertFalse(state["execution_allowed"])

        status, transfer = self.call(browser, "/api/scenarios/run", {"question": "给张伟转700元备注房租"})
        self.assertEqual(status, 200)
        self.assertEqual(transfer["result"]["status"], "pending_confirmation")
        status, confirmed = self.call(browser, "/api/scenarios/confirm", {"id": transfer["pending"][0]["id"]})
        self.assertEqual(status, 200)
        self.assertTrue(confirmed["success"])
        status, account = self.call(browser, "/api/account")
        self.assertEqual(status, 200)

        question = "帮我看看持仓是否太集中"
        status, routed = self.call(browser, "/api/scenarios/run", {"question": question})
        self.assertEqual(status, 200)
        self.assertTrue(routed["delegated"])
        request = {"question": question, "idempotency_key": "personal-joint-test-01",
                   "confirmed_cash_minor": account["cash_minor"]}
        status, result = self.call(browser, "/api/personal-fund/review", request)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["task_id"], result["risk_decision"]["task_id"])
        self.assertEqual(result["risk_callback"]["status"], "RECORDED")
        self.assertEqual(result["finance_account"]["cash_minor"], account["cash_minor"])
        self.assertTrue(result["risk_advice"]["input_confirmation"]["facts_confirmed"])
        self.assertFalse(result["risk_advice"]["input_confirmation"]["existing_holds_declared"])
        self.assertNotIn("尚未补齐cash_ledger_minor", result["assistant_message"])
        self.assertIn("尚未补齐cash_available_minor", result["assistant_message"])
        self.assertEqual(result["model_status"], "synthetic_test_adapter")
        self.assertFalse(result["execution_allowed"])
        self.assertFalse(result["real_model_calls_enabled"])

        status, replay = self.call(browser, "/api/personal-fund/review", request)
        self.assertEqual(status, 200)
        self.assertEqual(replay["task_id"], result["task_id"])
        self.assertTrue(replay["replayed"])
        status, changed = self.call(browser, "/api/personal-fund/review", {
            **request, "question": "修改问题后复用请求编号"})
        self.assertEqual(status, 409)
        self.assertFalse(changed["execution_allowed"])
        status, next_transfer = self.call(browser, "/api/scenarios/run", {"question": "给张伟转100元备注测试"})
        self.assertEqual(status, 200)
        status, _ = self.call(browser, "/api/scenarios/confirm", {"id": next_transfer["pending"][0]["id"]})
        self.assertEqual(status, 200)
        status, stale = self.call(browser, "/api/personal-fund/review", request)
        self.assertEqual(status, 409)
        self.assertFalse(stale["execution_allowed"])

    def test_guests_cannot_reuse_each_others_task(self):
        first, second = self.browser(), self.browser()
        request = {"question": "核对虚构资金安排", "idempotency_key": "same-browser-key-01",
                   "confirmed_cash_minor": 2568050}
        status_a, a = self.call(first, "/api/personal-fund/review", request)
        status_b, b = self.call(second, "/api/personal-fund/review", request)
        self.assertEqual((status_a, status_b), (200, 200))
        self.assertNotEqual(a["task_id"], b["task_id"])
        self.assertFalse(a["execution_allowed"] or b["execution_allowed"])

    def test_browser_cannot_set_identity_or_risk(self):
        browser = self.browser()
        status, result = self.call(browser, "/api/personal-fund/review", {
            "question": "核对虚构资金安排", "idempotency_key": "forged-field-01",
            "confirmed_cash_minor": 2568050, "user_id": "other-user", "risk_decision": "ALLOW"})
        self.assertEqual(status, 400)
        self.assertNotIn("task_id", result)
        status, result = self.call(browser, "/api/personal-fund/review", {
            "question": "核对虚构资金安排", "idempotency_key": "forged-field-02",
            "confirmed_cash_minor": 2568050, "risk_decision": "ALLOW"})
        self.assertEqual(status, 422)
        self.assertFalse(result["execution_allowed"])

    def test_inherited_flag_cannot_enable_joint_mode(self):
        env = dict(os.environ, FINANCE_JOINT_LOCAL="1",
            CORE_AGENT_BASE_URL="http://127.0.0.1:2222", CORE_AGENT_API_KEY="fake-core-key",
            RISK_CONVERSATION_BASE_URL="http://127.0.0.1:3333", RISK_CONVERSATION_API_KEY="fake-risk-key")
        process = subprocess.Popen(
            [sys.executable, "-u", str(ROOT / "qiqi/web/guest_gateway.py"),
             "--port", "0", "--frontend", "personal"],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                origin = json.loads(pool.submit(process.stdout.readline).result(timeout=15))["url"].rstrip("/")
            opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(CookieJar()), urllib.request.ProxyHandler({}))
            with opener.open(origin + "/", timeout=15):
                pass
            with opener.open(origin + "/api/personal-fund/status", timeout=15) as response:
                self.assertEqual(json.load(response)["core_risk"], "NOT_CONNECTED")
        finally:
            process.terminate()
            process.wait(timeout=10)
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
