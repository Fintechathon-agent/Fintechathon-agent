"""Run regressions without touching the project's demo balances, approvals or credentials."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path


def main():
    source = Path(__file__).resolve().parent.parent
    output = source / "artifacts" / "safety-fixes-2026-10-16"
    output.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix="finance-lab-safety-fixes-"))
    for folder in ("agent", "contracts", "demo", "evals", "web", "tests"):
        shutil.copytree(source / folder, workspace / folder,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules"))
    shutil.copy2(source / "verify_history.py", workspace / "verify_history.py")
    # No private config, runtime state, .env or API credentials are copied.
    for name in ("config.yaml", "config.fund.yaml"):
        shutil.copy2(source / "tests" / "config.browser.yaml", workspace / name)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", DEEPSEEK_API_KEY="", OPENAI_API_KEY="")
    manifest = {"started_at": datetime.now().isoformat(), "workspace": str(workspace),
                "tests": [], "files": {}}
    for folder in ("agent", "contracts", "web", "tests"):
        for path in (workspace / folder).rglob("*"):
            if path.is_file():
                manifest["files"][path.relative_to(workspace).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name, args in (("unittest", ["-m", "unittest", "discover", "-s", "tests", "-q"]),
                       ("safety_eval", ["-m", "evals.run_safety_eval"])):
        result = subprocess.run([sys.executable, *args], cwd=workspace, env=env,
                                capture_output=True, text=True, encoding="utf-8", timeout=180)
        text = (result.stdout or "") + (result.stderr or "")
        (output / f"{name}.txt").write_text(text, encoding="utf-8")
        manifest["tests"].append({"name": name, "exit_code": result.returncode, "command": args})
        print(name, "PASS" if result.returncode == 0 else "FAIL", flush=True)
        print(text[-2500:], flush=True)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Isolated workspace:", workspace, flush=True)
    return int(any(test["exit_code"] for test in manifest["tests"]))


if __name__ == "__main__":
    raise SystemExit(main())
