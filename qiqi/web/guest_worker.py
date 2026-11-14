"""Private loopback worker: one process, one browser guest, one mode."""
from __future__ import annotations
import argparse
from copy import deepcopy
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
    # No inherited cloud credential can trigger a paid call in this local runtime.
    for key in list(os.environ):
        if any(part in key for part in ("API_KEY", "API_TOKEN", "ACCESS_TOKEN", "AUTH_TOKEN")) or key.startswith(("CORE_AGENT_", "RISK_CONVERSATION_")):
            os.environ.pop(key, None)
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
                    return self._json({"reachable": False, "model_calls_enabled": False, "mode": "ISOLATED_GUEST"})
                return super().do_GET()

        def do_POST(self):
            if not self.authorized():
                return
            path = urlparse(self.path).path
            allowed = {"/api/scenarios/run", "/api/scenarios/confirm", "/api/scenarios/cancel", "/api/review",
                       "/api/decide", "/api/reset", "/api/breaker/reset", "/api/health-check/run", "/api/preferences"}
            if path not in allowed:
                self.close_connection = True
                return self._json({"error": "此本地访客入口未开放该能力", "execution_allowed": False}, 403)
            with self.app.state.lock:
                self.app.state.portfolio = account.portfolio()
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
