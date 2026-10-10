"""一键启动用户端（模块5）。

做三件事：
  1. 注入 LLM Key（优先环境变量；否则读本机 ~/.codex/auth.json，只在内存注入，不落盘）
  2. 选择配置：config.fund.relay.yaml（中转站，检测到本机凭据时）或 config.fund.yaml
  3. 启动 Web 服务并打开浏览器

用法：
    python web/launch.py                    # 默认端口 8765，自动开浏览器
    python web/launch.py --port 9000        # 指定端口
    python web/launch.py --config config.fund.yaml --no-open
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

AUTH_FILE = Path.home() / ".codex" / "auth.json"


def _inject_key() -> bool:
    """把本机凭据注入环境变量（不落盘）。返回是否注入成功。"""
    if os.environ.get("DEEPSEEK_API_KEY", "").strip():
        return True
    if not AUTH_FILE.exists():
        return False
    try:
        key = json.loads(AUTH_FILE.read_text(encoding="utf-8")).get("OPENAI_API_KEY", "")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[提示] 读取凭据失败（{exc}），将使用规则决策引擎。")
        return False
    if not key:
        return False
    os.environ["DEEPSEEK_API_KEY"] = key
    return True


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")      # type: ignore[union-attr]
    except Exception:      # noqa: BLE001
        pass
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.chdir(ROOT)

    parser = argparse.ArgumentParser(description="持仓哨兵 · 用户端一键启动")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--config", default="", help="配置文件路径（默认自动选择）")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--no-key", action="store_true", help="不注入本机凭据，强制规则决策")
    args = parser.parse_args(argv)

    has_key = False if args.no_key else _inject_key()

    config = args.config
    if not config:
        relay = ROOT / "config.fund.relay.yaml"
        config = str(relay) if (has_key and relay.exists()) else str(ROOT / "config.fund.yaml")

    serve_argv = ["--host", args.host, "--port", str(args.port), "--config", config]
    if not args.no_open:
        serve_argv.append("--open")

    from web.app import main as serve
    return serve(serve_argv)


if __name__ == "__main__":
    raise SystemExit(main())
