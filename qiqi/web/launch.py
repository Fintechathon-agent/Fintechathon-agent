"""一键启动用户端（模块5）。

做两件事：
  1. 只使用调用进程已经显式提供的 LLM 环境变量，不读取本机凭据文件
  2. 启动 Web 服务并打开浏览器

用法：
    python web/launch.py                    # 默认端口 8765，自动开浏览器
    python web/launch.py --port 9000        # 指定端口
    python web/launch.py --config config.fund.yaml --no-open
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")      # type: ignore[union-attr]
    except Exception:      # noqa: BLE001
        pass
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.chdir(ROOT)

    parser = argparse.ArgumentParser(description="Finance Lab · 金融 AI 安全任务台一键启动")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--config", default="", help="配置文件路径（默认自动选择）")
    parser.add_argument(
        "--cors-origin",
        default=os.environ.get("FINANCE_LAB_CORS_ORIGIN", ""),
        help="可选：允许 Preview 静态站点访问 API 的精确 Origin",
    )
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--no-key", action="store_true", help="不注入本机凭据，强制规则决策")
    args = parser.parse_args(argv)

    # 凭据只能由启动环境显式提供；保留 --no-key 作为兼容参数，
    # 但不再从 ~/.codex/auth.json 或其他本机文件读取任何秘密。
    if args.no_key:
        os.environ.pop("DEEPSEEK_API_KEY", None)

    config = args.config or str(ROOT / "config.fund.yaml")

    serve_argv = ["--host", args.host, "--port", str(args.port), "--config", config]
    if args.cors_origin:
        serve_argv.extend(["--cors-origin", args.cors_origin])
    if not args.no_open:
        serve_argv.extend(["--open", "--open-path", "/team/"])

    from web.app import main as serve
    return serve(serve_argv)


if __name__ == "__main__":
    raise SystemExit(main())
