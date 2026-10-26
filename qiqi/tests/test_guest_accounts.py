"""Real HTTP guest boundaries and atomic shared-wallet regression tests."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from unittest.mock import patch

from contracts.types import ActionType, Recommendation
from agent.tools.paper_trade import TradeRecord
from web.guest_gateway import GuestRegistry, GuestServer, exclusive_directory
from web.unified_account import UnifiedAccount, UnifiedPaperTrader


class Client:
    def __init__(self, port):
        self.port, self.cookie = port, ""

    def request(self, path, payload=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=25)
        try:
            h = {"Cookie": self.cookie, "Content-Type": "application/json", **(headers or {})}
            connection.request("GET" if payload is None else "POST", path,
                               None if payload is None else json.dumps(payload), h)
            response = connection.getresponse()
            raw = response.read()
            if response.getheader("Set-Cookie"):
                self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
            return response.status, json.loads(raw) if "json" in response.getheader("Content-Type", "") else raw
        finally:
            connection.close()

    def ok(self, path, payload=None):
        status, body = self.request(path, payload)
        assert status == 200, (status, body)
        return body


class GuestHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="guest-http-tests-")
        self.root = Path(self.temp.name)
        self.registry = GuestRegistry(self.root)
        self.server = GuestServer(("127.0.0.1", 0), self.registry)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.registry.close()
        self.temp.cleanup()

    def client(self):
        client = Client(self.server.server_port)
        code, _ = client.request("/", headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"})
        self.assertEqual(code, 200)
        return client

    def test_two_guests_cannot_read_or_approve_each_others_tasks_or_preferences(self):
        a, b = self.client(), self.client()
        self.assertNotEqual(a.ok("/api/account")["user_id"], b.ok("/api/account")["user_id"])
        request = a.ok("/api/scenarios/run", {"question": "给张伟转账700元，备注房租"})
        action = request["pending"][-1]["id"]
        self.assertFalse(b.ok("/api/scenarios/confirm", {"id": action})["success"])
        self.assertEqual(b.ok("/api/scenarios/boot")["pending"], [])
        self.assertTrue(a.ok("/api/scenarios/confirm", {"id": action})["success"])
        self.assertEqual(a.ok("/api/bootstrap")["portfolio"]["cash"], 24980.50)
        self.assertEqual(b.ok("/api/bootstrap")["portfolio"]["cash"], 25680.50)
        a.ok("/api/preferences", {"minimum_cash": "6000.00", "expected_version": 0})
        a.ok("/api/preferences", {"minimum_cash": "8000", "expected_version": 1})
        self.assertEqual(a.ok("/api/account")["spendable_cash"], 16980.50)
        self.assertIsNone(b.ok("/api/account")["preferences"]["minimum_cash_minor"])
        self.assertIn("8000.00", a.ok("/api/memory")["summary"])
        self.assertNotIn("8000.00", b.ok("/api/memory")["summary"])
        self.assertEqual(a.request("/api/preferences", {"minimum_cash": "0", "expected_version": 1})[0], 409)
        a.ok("/api/preferences", {"minimum_cash": None, "expected_version": 2})
        self.assertNotIn("8000.00", a.ok("/api/memory")["summary"])
        audit_b = json.dumps(b.ok("/api/audit"), ensure_ascii=False)
        self.assertNotIn(action, audit_b)

    def test_updated_preference_blocks_previously_queued_transfer(self):
        a = self.client()
        task = a.ok("/api/scenarios/run", {"question": "给张伟转账700元"})["pending"][-1]["id"]
        a.ok("/api/preferences", {"minimum_cash": "25000", "expected_version": 0})
        result = a.ok("/api/scenarios/confirm", {"id": task})
        self.assertFalse(result["success"])
        self.assertEqual(a.ok("/api/account")["cash_minor"], 2568050)
        self.assertEqual(a.ok("/api/bootstrap")["portfolio"]["cash"], 25680.50)
        new_plan = a.ok("/api/scenarios/run", {"question": "给张伟转账700元，备注房租"})
        self.assertEqual(new_plan["result"]["status"], "blocked")
        self.assertEqual(new_plan["pending"], [])

    def test_real_investment_http_flow_updates_the_same_transfer_balance_once(self):
        a = self.client()
        review = a.ok("/api/review", {"question": "平安银行卖出30%"})
        self.assertTrue(review["queued"])
        action = a.ok("/api/approvals")["approvals"][0]["id"]
        confirmation = {"id": action, "approved": True, "verification": {"sms_code": "123456", "face_verified": True}}
        fill = a.ok("/api/decide", confirmation)
        self.assertTrue(fill["executed"], fill)
        receipt = fill["trade_record"]
        cash = round(25680.50 + receipt["amount"] - receipt["commission"], 2)
        self.assertEqual(a.ok("/api/scenarios/boot")["balance"], cash)
        self.assertEqual(a.ok("/api/bootstrap")["portfolio"]["cash"], cash)
        self.assertTrue(a.ok("/api/decide", confirmation)["replayed"])
        self.assertEqual(a.ok("/api/scenarios/boot")["balance"], cash)
        self.assertEqual(len(a.ok("/api/trades")["trades"]), 1)
        # Restart this guest process; ledger and session remain unchanged.
        identity = self.registry.verify(a.cookie)
        self.registry.stop(self.registry.workers.pop(identity))
        self.assertEqual(a.ok("/api/bootstrap")["portfolio"]["cash"], cash)
        self.assertEqual(a.ok("/api/scenarios/boot")["balance"], cash)

    def test_one_guest_entry_handles_bill_transfer_and_investment(self):
        a = self.client()
        guest = a.ok("/api/account")["user_id"]
        bill = a.ok("/api/scenarios/run", {"question": "这个月账单分析"})
        self.assertEqual(bill["result"]["scenario"], "bill")
        self.assertEqual(bill["result"]["status"], "done")
        transfer = a.ok("/api/scenarios/run", {"question": "给张伟转账700元，备注房租"})
        self.assertEqual(transfer["result"]["scenario"], "transfer")
        self.assertEqual(transfer["result"]["status"], "pending_confirmation")
        self.assertTrue(a.ok("/api/scenarios/confirm", {"id": transfer["pending"][-1]["id"]})["success"])
        review = a.ok("/api/review", {"question": "平安银行卖出30%"})
        self.assertTrue(review["queued"])
        self.assertEqual(a.ok("/api/account")["user_id"], guest)
        self.assertEqual(a.ok("/api/bootstrap")["portfolio"]["cash"], 24980.50)

    def test_signed_cookie_mode_csrf_identity_and_private_worker_boundaries(self):
        anonymous = Client(self.server.server_port)
        self.assertEqual(anonymous.request("/api/account")[0], 401)
        a = self.client()
        self.assertEqual(a.request("/api/preferences", {"minimum_cash": "0", "expected_version": 0},
                                   {"Origin": "https://untrusted.invalid"})[0], 403)
        self.assertEqual(a.request("/api/scenarios/run", {"question": "余额", "user_id": "demo_user"})[0], 400)
        self.assertEqual(a.request("/api/core-agent/review", {"question": "hello"})[0], 403)
        self.assertEqual(a.request("/api/account", headers={"Host": "attacker.invalid"})[0], 403)
        identity = self.registry.verify(a.cookie)
        private = Client(self.registry.workers[identity]["port"])
        self.assertEqual(private.request("/api/account")[0], 401)
        live = GuestRegistry(self.root, "live")
        self.assertIsNone(live.verify(a.cookie.replace("fund_guest_demo", "fund_guest_live")))
        a.cookie = a.cookie[:-1] + ("0" if a.cookie[-1] != "0" else "1")
        self.assertEqual(a.request("/api/account")[0], 401)

    def test_reset_is_guest_scoped_and_retains_explicit_preferences(self):
        a, b = self.client(), self.client()
        a.ok("/api/preferences", {"minimum_cash": "6000", "expected_version": 0})
        task = b.ok("/api/scenarios/run", {"question": "给张伟转账700元"})["pending"][-1]["id"]
        b.ok("/api/scenarios/confirm", {"id": task})
        a.ok("/api/reset", {})
        self.assertEqual(a.ok("/api/account")["preferences"]["minimum_cash_minor"], 600000)
        self.assertEqual(b.ok("/api/account")["cash_minor"], 2498050)

    def test_live_mode_cannot_reuse_demo_cookie_or_client_verification(self):
        demo = self.client()
        demo.ok("/api/preferences", {"minimum_cash": "6000", "expected_version": 0})
        registry = GuestRegistry(self.root, "live")
        server = GuestServer(("127.0.0.1", 0), registry)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            live = Client(server.server_port)
            live.cookie = demo.cookie
            self.assertEqual(live.request("/api/account")[0], 401)
            live.ok("/")
            self.assertIsNone(live.ok("/api/account")["preferences"]["minimum_cash_minor"])
            task = live.ok("/api/scenarios/run", {"question": "给张伟转账700元"})["pending"][-1]["id"]
            code, result = live.request("/api/scenarios/confirm", {"id": task, "verification": {"sms_code": "123456", "face_verified": True}})
            self.assertEqual(code, 403)
            self.assertFalse(result["executed"])
            self.assertEqual(live.ok("/api/account")["cash_minor"], 2568050)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
            registry.close()


class UnifiedLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="unified-ledger-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.account = UnifiedAccount(self.root / "ledger", "synthetic-owner", "demo")
        self.trader = UnifiedPaperTrader(self.account, self.root / "trades")
        self.buy = Recommendation(action=ActionType.BUY, symbol="SYNTHETIC", quantity=2000, price=10, reason="合成并发夹具")
        self.record = TradeRecord("fill-1", "approval-1", "2026-10-25T00:00:00", "买入", "SYNTHETIC", "模拟标的", 10, 2000, 20000, 6)

    def test_transfer_and_investment_concurrency_cannot_spend_the_same_cash(self):
        def transfer():
            try:
                self.account.record_transfer(20000)
                return True
            except ValueError:
                return False
        with patch.object(self.trader, "_do_trade", return_value=self.record), ThreadPoolExecutor(2) as pool:
            first = pool.submit(transfer)
            second = pool.submit(self.trader.execute_once, self.buy, "approval-1")
            transferred, filled = first.result(), second.result().success
        self.assertNotEqual(transferred, filled)
        self.assertEqual(self.account.cash_minor, 568050 if transferred else 567450)
        restored = UnifiedAccount(self.root / "ledger", "synthetic-owner", "demo")
        self.assertEqual(restored.cash_minor, self.account.cash_minor)
        self.assertEqual(restored.portfolio().cash, restored.balance)

    def test_atomic_write_failure_leaves_no_cash_position_or_receipt_change(self):
        before = deepcopy(self.account._dump())
        with patch.object(self.trader, "_do_trade", return_value=self.record), patch("web.banking_demo.atomic_write_json", side_effect=OSError("fixture disk failure")):
            result = self.trader.execute_once(self.buy, "approval-1")
        self.assertFalse(result.success)
        self.assertEqual(self.account._dump(), before)
        self.assertEqual(self.trader.get_trade_history("approval-1"), [])

    def test_replay_changed_parameters_and_floor_are_checked(self):
        self.account.update_preferences({"minimum_cash": "6000", "expected_version": 0})
        with patch.object(self.trader, "_do_trade", return_value=self.record):
            self.assertFalse(self.trader.execute_once(self.buy, "approval-1").success)
            self.account.update_preferences({"minimum_cash": None, "expected_version": 1})
            self.assertTrue(self.trader.execute_once(self.buy, "approval-1").success)
            self.assertTrue(self.trader.execute_once(self.buy, "approval-1").success)
            self.buy.quantity = 1
            self.assertFalse(self.trader.execute_once(self.buy, "approval-1").success)
        self.assertEqual(self.account.cash_minor, 567450)
        self.assertEqual(len(self.account.fills), 1)

    def test_legacy_or_mismatched_owner_is_not_loaded_and_root_is_exclusive(self):
        self.account.record_transfer(1)
        with self.assertRaises(ValueError):
            UnifiedAccount(self.root / "ledger", "another-owner", "demo")
        with self.assertRaises(ValueError):
            UnifiedAccount(self.root / "ledger", "synthetic-owner", "live")
        with exclusive_directory(self.root):
            with self.assertRaises(OSError), exclusive_directory(self.root):
                pass

    def test_missing_cash_in_existing_ledger_does_not_restore_fixture_balance(self):
        self.account.record_transfer(1)
        raw = json.loads(self.account._path().read_text(encoding="utf-8"))
        raw.pop("cash_minor")
        self.account._path().write_text(json.dumps(raw), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "缺失关键状态"):
            UnifiedAccount(self.root / "ledger", "synthetic-owner", "demo")
