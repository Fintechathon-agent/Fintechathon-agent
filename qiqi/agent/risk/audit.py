"""审计日志——记录所有操作，供安全复查与合规审查。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional


class AuditLogger:
    """审计日志记录器——写入 JSON Lines 格式的日志文件"""

    def __init__(self, log_dir: Path | str = "data/audit"):
        self.dir = Path(log_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        action: str,
        user_id: str,
        session_id: str,
        detail: dict,
        result: Literal["success", "failure", "pending"] = "success",
    ) -> Path:
        """写入一条审计日志"""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "user_id": user_id,
            "session_id": session_id,
            "result": result,
            **detail,
        }
        date_str = datetime.now().strftime("%Y-%m-%d")
        p = self.dir / f"audit_{date_str}.jsonl"
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return p

    def query(
        self,
        user_id: str = "",
        session_id: str = "",
        action: str = "",
        date_str: str = "",
    ) -> list[dict]:
        """查询审计日志（默认查当天）"""
        target_date = date_str or datetime.now().strftime("%Y-%m-%d")
        p = self.dir / f"audit_{target_date}.jsonl"
        if not p.exists():
            return []
        results = []
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                d = json.loads(line)
                if user_id and d.get("user_id") != user_id:
                    continue
                if session_id and d.get("session_id") != session_id:
                    continue
                if action and d.get("action") != action:
                    continue
                results.append(d)
            except json.JSONDecodeError:
                continue
        return results


# ------------------------------------------------------------ 全局审计器


_audit_logger: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger


def log_action(
    action: str,
    user_id: str,
    session_id: str,
    detail: dict,
    result: str = "success",
) -> Path:
    return get_audit_logger().log(action, user_id, session_id, detail, result)
