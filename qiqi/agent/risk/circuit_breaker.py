"""异常熔断——连续安全事件达到阈值后锁定执行链路，需人工确认恢复。

对齐赛题安全机制「异常熔断：连续失败或可疑行为触发安全锁定」。

熔断信号（安全事件）：
  · gate_block             风控闸门拦截（建议未通过确定性检查 / fail-closed）
  · memory_write_rejected  记忆写入门卫拒绝（疑似提示注入）
  · strong_verify_failed   红色权限强验证失败（连续失败即"可疑行为"）
  · loop_error             主链路执行异常

窗口内出现一次干净运行（无安全事件）则连续计数清零；
锁定后只有人工确认（reset）才能恢复——宁可停摆，不可带病放行。
"""
from __future__ import annotations

import json
import logging
import threading
from copy import deepcopy
from agent.core.storage import atomic_write_json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD = 3
DEFAULT_WINDOW_SECONDS = 600
DEFAULT_STATE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "breaker"


@dataclass
class BreakerState:
    locked: bool = False
    consecutive_failures: int = 0
    locked_at: str = ""
    reason: str = ""
    threshold: int = DEFAULT_THRESHOLD
    window_seconds: int = DEFAULT_WINDOW_SECONDS
    events: list[dict] = field(default_factory=list)


class CircuitBreaker:
    """线程安全的熔断器，状态落盘（重启后锁定状态保持）。"""

    def __init__(
        self,
        state_dir: Path | str = DEFAULT_STATE_DIR,
        threshold: int = DEFAULT_THRESHOLD,
        window_seconds: int = DEFAULT_WINDOW_SECONDS,
    ):
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.threshold = threshold
        self.window_seconds = window_seconds
        self._lock = threading.RLock()
        self._state = self._load()

    # ---- 状态持久化 ----

    def _path(self) -> Path:
        return self.dir / "state.json"

    def _load(self) -> BreakerState:
        try:
            raw = json.loads(self._path().read_text(encoding="utf-8"))
            return BreakerState(
                locked=bool(raw.get("locked", False)),
                consecutive_failures=int(raw.get("consecutive_failures", 0)),
                locked_at=str(raw.get("locked_at", "")),
                reason=str(raw.get("reason", "")),
                threshold=int(raw.get("threshold", self.threshold)),
                window_seconds=int(raw.get("window_seconds", self.window_seconds)),
                events=[dict(e) for e in raw.get("events", [])],
            )
        except FileNotFoundError:
            return BreakerState(
                threshold=self.threshold, window_seconds=self.window_seconds,
            )
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            return BreakerState(locked=True, reason="state_unreadable",
                                threshold=self.threshold, window_seconds=self.window_seconds)

    def _save(self) -> None:
        try:
            atomic_write_json(self._path(), asdict(self._state))
        except OSError as exc:      # pragma: no cover
            self._state.locked = True
            self._state.reason = "state_write_failed"
            raise OSError("熔断状态保存失败，执行链路已暂停") from exc

    # ---- 事件 ----

    def record_failure(self, kind: str, detail: Optional[dict] = None, user_id: str = "") -> dict:
        """记录一次安全事件；达到阈值即锁定并留审计。"""
        with self._lock:
            st = self._state
            now = datetime.now().isoformat(timespec="seconds")
            st.events.append({
                "kind": kind, "detail": dict(detail or {}),
                "user_id": user_id or "", "at": now,
            })
            st.events = st.events[-20:]
            st.consecutive_failures += 1
            if not st.locked and st.consecutive_failures >= self.threshold:
                st.locked = True
                st.locked_at = now
                st.reason = kind
                _audit_locked(kind, st.consecutive_failures)
            self._save()
            return self.state()

    def record_ok(self) -> dict:
        """一次干净运行：清除连续计数（已锁定则不自动解锁）。"""
        with self._lock:
            st = self._state
            if not st.locked and st.consecutive_failures:
                st.consecutive_failures = 0
                self._save()
            return self.state()

    def is_locked(self) -> bool:
        with self._lock:
            return self._state.locked

    def state(self) -> dict:
        with self._lock:
            return asdict(self._state)

    def reset(self, note: str = "人工确认恢复") -> dict:
        """人工确认后恢复。"""
        with self._lock:
            previous = deepcopy(self._state)
            self._state = BreakerState(
                threshold=self.threshold, window_seconds=self.window_seconds,
            )
            try:
                self._save()
            except OSError:
                self._state = previous
                self._state.locked = True
                raise
            try:
                from agent.risk.audit import log_action
                log_action("breaker_reset", "", "", {"note": note}, "success")
            except Exception as exc:      # pragma: no cover
                logger.warning("熔断恢复审计失败：%s", exc)
            return self.state()


def _audit_locked(kind: str, count: int) -> None:
    try:
        from agent.risk.audit import log_action
        log_action("breaker_locked", "", "", {
            "trigger_kind": kind,
            "consecutive_failures": count,
            "note": "连续安全事件超阈值，执行链路已锁定，需人工确认恢复",
        }, "failure")
    except Exception as exc:      # pragma: no cover
        logger.warning("熔断锁定审计失败：%s", exc)


# ---- 全局单例 ----

_breaker: Optional[CircuitBreaker] = None


def init_breaker(state_dir: Path | str = DEFAULT_STATE_DIR,
                 threshold: int = DEFAULT_THRESHOLD,
                 window_seconds: int = DEFAULT_WINDOW_SECONDS) -> CircuitBreaker:
    """初始化/重置全局熔断器（build_orchestrator 调用）。"""
    global _breaker
    _breaker = CircuitBreaker(state_dir, threshold, window_seconds)
    return _breaker


def get_breaker() -> CircuitBreaker:
    global _breaker
    if _breaker is None:
        _breaker = CircuitBreaker()
    return _breaker
