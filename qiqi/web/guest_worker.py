"""Private loopback worker: one process, one browser guest, one mode."""
from __future__ import annotations
import argparse
from copy import deepcopy
from decimal import Decimal
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--guest", required=True)
    parser.add_argument("--mode", choices=("demo", "live"), required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{32}", args.guest):
        raise ValueError("Invalid server-issued guest identity")
    token = os.environ.pop("FINANCE_GUEST_BACKEND_TOKEN", "")
    if len(token) < 40:
        raise ValueError("Private gateway credential required")
    joint_local = os.environ.pop("FINANCE_JOINT_LOCAL", "") == "1" and args.mode == "demo"
    joint_settings = {key: os.environ.get(key, "") for key in
                      ("CORE_AGENT_BASE_URL", "CORE_AGENT_API_KEY",
                       "RISK_CONVERSATION_BASE_URL", "RISK_CONVERSATION_API_KEY")}
    # No inherited cloud credential can trigger a paid call in this local runtime.
    for key in list(os.environ):
        if any(part in key for part in ("API_KEY", "API_TOKEN", "ACCESS_TOKEN", "AUTH_TOKEN")) or key.startswith(("CORE_AGENT_", "RISK_CONVERSATION_")):
            os.environ.pop(key, None)
    if joint_local:
        if (not all(joint_settings.values()) or
                not all(joint_settings[key].startswith("http://127.0.0.1:") for key in
                        ("CORE_AGENT_BASE_URL", "RISK_CONVERSATION_BASE_URL"))):
            raise ValueError("Local joint service configuration is invalid")
        os.environ.update(joint_settings)
    else:
        os.environ["CORE_AGENT_BASE_URL"] = "http://127.0.0.1:1"
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    config = {"llm": {"api_key": ""}, "financial": {"market_source": "mock", "news_source": "mock"},
              "paths": {key: str(directory / key) for key in
                        ("memory_dir", "audit_dir", "approval_dir", "paper_trade_dir", "breaker_dir")}}
    config_path = directory / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    from web import app, banking_demo, banking_service
    from web.unified_account import UnifiedAccount, UnifiedPaperTrader, PreferenceConflict

    owner = f"guest_{args.mode}_{args.guest}"
    app.USER_ID = banking_service.USER_ID = owner
    original_user = app.demo_user

    def current_user():
        user = original_user()
        user.user_id, user.name = owner, "本浏览器访客"
        return user

    app.demo_user = current_user
    account = UnifiedAccount(directory / "ledger", owner, args.mode)
    banking_demo._state = account

    class GuestApp(app.DemoApp):
        def _rehydrate_portfolio(self):
            return account.portfolio()

        def trades(self, limit=100):
            with account._lock:
                rows = [deepcopy(fill["receipt"]) for fill in account.fills.values()]
                return sorted(rows, key=lambda row: row["timestamp"], reverse=True)[:limit]

        def _memory_summary(self):
            base = super()._memory_summary()
            floor = account.preferences["minimum_cash_minor"]
            return base + (f"\n用户显式确认最低现金保留 {floor / 100:.2f} 元（版本 {account.preferences['version']}）。" if floor is not None else "")

    class GuestHandler(app.Handler):
        def authorized(self):
            if not hmac.compare_digest(self.headers.get("X-Finance-Backend-Token", ""), token):
                self.close_connection = True
                self._json({"error": "Private guest worker"}, 401)
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            with self.app.state.lock:
                self.app.state.portfolio = account.portfolio()
                path = urlparse(self.path).path
                if path == "/api/account":
                    return self._json(account.summary())
                if path == "/api/core-agent/status":
                    return self._json({"reachable": joint_local, "model_calls_enabled": False,
                                       "mode": "LOCAL_SYNTHETIC_JOINT" if joint_local else "ISOLATED_GUEST"})
                if path == "/api/personal-fund/status":
                    return self._json({"frontend": "PERSONAL_AI_FUND_MANAGER", "finance": "LOCAL_GUEST_LEDGER",
                                       "core_risk": "LOCAL_SYNTHETIC_JOINT" if joint_local else "NOT_CONNECTED",
                                       "execution_allowed": False, "real_model_calls_enabled": False})
                return super().do_GET()

        def do_POST(self):
            if not self.authorized():
                return
            path = urlparse(self.path).path
            allowed = {"/api/scenarios/run", "/api/scenarios/confirm", "/api/scenarios/cancel", "/api/review",
                       "/api/decide", "/api/reset", "/api/breaker/reset", "/api/health-check/run", "/api/preferences",
                       "/api/personal-fund/review"}
            if path not in allowed:
                self.close_connection = True
                return self._json({"error": "此本地访客入口未开放该能力", "execution_allowed": False}, 403)
            with self.app.state.lock:
                self.app.state.portfolio = account.portfolio()
                if path == "/api/personal-fund/review":
                    if not joint_local:
                        return self._json({"error": "Core/Risk 联合服务未接通；没有回退为 Finance 单机结论",
                                           "execution_allowed": False}, 503)
                    body = self._body_json()
                    question, request_key = body.get("question"), body.get("idempotency_key")
                    confirmed_cash = body.get("confirmed_cash_minor")
                    if (set(body) != {"question", "idempotency_key", "confirmed_cash_minor"} or not isinstance(question, str)
                            or not 1 <= len(question.strip()) <= 2000 or not isinstance(request_key, str)
                            or not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", request_key)
                            or type(confirmed_cash) is not int):
                        return self._json({"error": "请先核对本浏览器的演示现金；不接受浏览器指定账户、风控或批准字段",
                                           "execution_allowed": False}, 422)
                    from web import risk_conversation
                    account_before = account.summary()
                    if confirmed_cash != account_before["cash_minor"]:
                        return self._json({"error": "演示余额已变化，请重新核对后发起新任务",
                                           "execution_allowed": False}, 409)
                    floor = account_before["preferences"]["minimum_cash_minor"]
                    finance = {"cash_yuan": str(Decimal(account_before["cash_minor"]) / 100),
                               "floor_yuan": str(Decimal(floor) / 100) if floor is not None else None,
                               "amount_yuan": None, "fees_yuan": None, "holds_yuan": None,
                               "purpose_yuan": None, "due_yuan": None,
                               "facts_confirmed": True, "purpose_confirmed": False}
                    try:
                        scoped_key = "pf-" + hashlib.sha256(f"{owner}:{request_key}".encode()).hexdigest()
                        status, result = risk_conversation.review({"question": question.strip(),
                            "idempotency_key": scoped_key, "daily_finance_yuan": finance})
                    except risk_conversation.ConversationError as exc:
                        return self._json(exc.payload(), exc.status)
                    if status >= 400:
                        return self._json({"error": result.get("error") or "Core/Risk 请求未完成",
                                           "error_code": result.get("error_code"),
                                           "execution_allowed": False}, status)
                    if (status != 200 or not result.get("task_id")
                            or result.get("risk_decision", {}).get("task_id") != result["task_id"]
                            or result.get("risk_decision", {}).get("auth", {}).get("verified") is not True
                            or result.get("risk_callback", {}).get("status") not in ("RECORDED", "DUPLICATE")):
                        return self._json({"error": "Core/Risk 同任务回写证据不完整，结果未采用",
                                           "execution_allowed": False}, 502)
                    result["finance_account"] = {"cash_minor": account_before["cash_minor"],
                        "preferences_version": account_before["preferences"]["version"],
                        "scope": "THIS_BROWSER_AND_MODE", "identity_verified": False}
                    result["joint_profile"] = "LOCAL_SYNTHETIC_JOINT"
                    result["model_status"] = "synthetic_test_adapter"
                    result["real_model_calls_enabled"] = False
                    return self._json(result)
                if path == "/api/preferences":
                    try:
                        result = account.update_preferences(self._body_json())
                        banking_service._flush_audit(account)
                        return self._json(result)
                    except PreferenceConflict as exc:
                        return self._json({"error": str(exc)}, 409)
                    except ValueError as exc:
                        return self._json({"error": str(exc)}, 400)
                try:
                    return super().do_POST()
                finally:
                    self.app.state.portfolio = account.portfolio()
                    banking_service._flush_audit(account)

    instance = GuestApp(str(config_path), args.mode)
    instance.orch.paper_trader = UnifiedPaperTrader(account, directory / "paper_trade_dir")
    server = app.Server(("127.0.0.1", 0), GuestHandler, instance)
    print(json.dumps({"port": server.server_port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
