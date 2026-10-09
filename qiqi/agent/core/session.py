"""Session 管理——会话生命周期、会话 ID、超时与活跃状态。
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from contracts.types import AgentPhase


@dataclass
class Session:
    """一次用户会话的生命周期对象"""
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    user_id: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_active: str = field(default_factory=lambda: datetime.now().isoformat())
    phase: AgentPhase = AgentPhase.IDLE
    current_task: str = ""
    retry_count: int = 0
    max_retries: int = 3
    error: str = ""

    def touch(self) -> None:
        """更新最后活跃时间"""
        self.last_active = datetime.now().isoformat()

    def is_expired(self, ttl_minutes: int = 30) -> bool:
        """检查会话是否超时"""
        last = datetime.fromisoformat(self.last_active)
        return datetime.now() - last > timedelta(minutes=ttl_minutes)

    def should_retry(self) -> bool:
        return self.retry_count < self.max_retries

    def increment_retry(self) -> None:
        self.retry_count += 1

    def set_phase(self, phase: AgentPhase, task: str = "") -> None:
        self.phase = phase
        self.current_task = task
        self.touch()

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "last_active": self.last_active,
            "phase": self.phase.value,
            "current_task": self.current_task,
            "retry_count": self.retry_count,
            "error": self.error,
        }


class SessionManager:
    """Session 内存管理器，支持多用户并发"""

    def __init__(self, ttl_minutes: int = 30):
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        self._ttl = ttl_minutes

    def create(self, user_id: str, session_id: str = "") -> Session:
        """创建新会话"""
        with self._lock:
            sid = session_id or uuid.uuid4().hex[:8]
            sess = Session(session_id=sid, user_id=user_id)
            self._sessions[sid] = sess
            return sess

    def get(self, session_id: str) -> Optional[Session]:
        """获取会话，不存在返回 None"""
        with self._lock:
            sess = self._sessions.get(session_id)
            if sess and not sess.is_expired(self._ttl):
                return sess
            return None

    def touch(self, session_id: str) -> bool:
        """更新活跃时间，找不到或已过期返回 False"""
        with self._lock:
            sess = self._sessions.get(session_id)
            if not sess:
                return False
            if sess.is_expired(self._ttl):
                del self._sessions[session_id]
                return False
            sess.touch()
            return True

    def remove(self, session_id: str) -> bool:
        """删除会话"""
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    def list_active(self) -> list[Session]:
        """列出所有未过期的活跃会话"""
        with self._lock:
            now = datetime.now()
            active = []
            for sess in self._sessions.values():
                if not sess.is_expired(self._ttl):
                    active.append(sess)
            return active

    def cleanup_expired(self) -> int:
        """清理所有过期会话，返回清理数量"""
        with self._lock:
            before = len(self._sessions)
            self._sessions = {
                sid: s for sid, s in self._sessions.items()
                if not s.is_expired(self._ttl)
            }
            return before - len(self._sessions)
