"""Agent 运行时状态——Phase 状态机、任务上下文、待审批对象。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from contracts.types import AgentPhase, ApprovalRequest, Portfolio, Recommendation


@dataclass
class AgentState:
    """会话内的运行时状态——描述 Agent 当前在做什么、结果是什么"""
    phase: AgentPhase = AgentPhase.IDLE
    current_task: str = ""
    pending_approval: Optional[ApprovalRequest] = None
    last_recommendation: Optional[Recommendation] = None
    last_portfolio: Optional[Portfolio] = None
    error_message: str = ""
    step_history: list[str] = field(default_factory=list)  # 操作步骤记录

    def set_phase(self, phase: AgentPhase, task: str = "") -> None:
        self.phase = phase
        if task:
            self.current_task = task
        self.step_history.append(f"[{phase.value}] {task}")

    def has_pending_approval(self) -> bool:
        return self.pending_approval is not None and \
            self.pending_approval.status == "pending"

    def clear_error(self) -> None:
        self.error_message = ""

    def to_dict(self) -> dict:
        return {
            "phase": self.phase.value,
            "current_task": self.current_task,
            "has_pending_approval": self.has_pending_approval(),
            "error": self.error_message,
            "steps": self.step_history,
        }
