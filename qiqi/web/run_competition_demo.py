"""Run the existing Finance Lab UI with isolated synthetic state and no model calls."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--state-dir", type=Path, help="Reuse an explicitly selected synthetic demo directory.")
    args = parser.parse_args()
    directory = args.state_dir.resolve() if args.state_dir else Path(tempfile.mkdtemp(prefix="competition-demo-"))
    directory.mkdir(parents=True, exist_ok=True)
    for key in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "CORE_AGENT_API_KEY",
                "RISK_CONVERSATION_BASE_URL", "RISK_CONVERSATION_API_KEY"):
        os.environ[key] = ""
    os.environ["CORE_AGENT_BASE_URL"] = "http://127.0.0.1:1"
    config = {"llm": {"api_key": ""}, "financial": {"market_source": "mock", "news_source": "mock"},
              "paths": {key: str(directory / key) for key in
                        ("memory_dir", "audit_dir", "approval_dir", "paper_trade_dir", "breaker_dir")}}
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", prefix="config-", dir=directory, delete=False) as handle:
        json.dump(config, handle)
        config_path = handle.name
    from web import banking_demo
    banking_demo.STATE_DIR = directory / "banking"
    from web.app import DemoApp, Handler, Server

    class OfflineHandler(Handler):
        def do_POST(self):
            if urlparse(self.path).path == "/api/core-agent/review":
                return self._json({"error_code": "MODEL_CALLS_DISABLED", "error": "此隔离演示只运行确定性工具。", "execution_allowed": False}, 423)
            return super().do_POST()

        def do_GET(self):
            if urlparse(self.path).path == "/api/core-agent/status":
                return self._json({"reachable": False, "model_calls_enabled": False, "mode": "ISOLATED_SYNTHETIC_DEMO"})
            return super().do_GET()

    server = Server(("127.0.0.1", args.port), OfflineHandler, DemoApp(config_path, mode="demo"))
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/", "state_directory": str(directory),
                      "mode": "ISOLATED_SYNTHETIC_DEMO", "real_model_calls_enabled": False}, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
