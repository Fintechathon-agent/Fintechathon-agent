from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class HistoryVerificationTests(unittest.TestCase):
    """严格验算：引擎输出必须与原始历史数据的独立 numpy 复算一致。

    验证脚本 verify_history.py 的参考实现只用 numpy 与原始序列，
    不引用任何引擎内部函数；任何不一致都视为引擎缺陷。
    """

    def test_history_verification_passes(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / "verify_history.py")],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT),
            timeout=120,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        self.assertEqual(proc.returncode, 0, msg=output)
        self.assertIn("ALL CHECKS PASSED", output)


if __name__ == "__main__":
    unittest.main()
