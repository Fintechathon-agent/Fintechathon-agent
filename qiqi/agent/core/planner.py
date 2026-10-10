"""按意图生成可审计的任务 DAG。"""
from __future__ import annotations

from dataclasses import dataclass, field

from .intent import IntentResult


@dataclass
class PlanNode:
    id: str
    label: str
    tool: str
    depends_on: list[str] = field(default_factory=list)
    status: str = "pending"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "tool": self.tool,
            "depends_on": list(self.depends_on),
            "status": self.status,
        }


@dataclass
class TaskPlan:
    intent: str
    nodes: list[PlanNode]

    def mark(self, node_id: str, status: str) -> None:
        node = next((item for item in self.nodes if item.id == node_id), None)
        if node:
            node.status = status

    def skip_after(self, node_id: str) -> None:
        found = False
        for node in self.nodes:
            if found and node.status == "pending":
                node.status = "skipped"
            if node.id == node_id:
                found = True

    def to_dict(self) -> dict:
        return {"intent": self.intent, "nodes": [node.to_dict() for node in self.nodes]}


def build_plan(intent: IntentResult) -> TaskPlan:
    """不同意图得到不同节点；节点依赖显式表达 DAG，而非 UI 假动画。"""
    validate = PlanNode("validate", "校验输入与权限", "intent_router")
    if intent.name in {"unsafe", "out_of_scope", "insufficient"}:
        validate.status = "blocked" if intent.blocked else "done"
        return TaskPlan(intent.name, [validate])

    nodes = [
        validate,
        PlanNode("market", "读取持仓与行情", "market_fetcher", ["validate"]),
        PlanNode("news", "检索关联资讯", "news_fetcher", ["validate"]),
        PlanNode("analyze", "组合诊断", "portfolio_analyzer", ["market"]),
        PlanNode("risk", "风险与适当性检查", "risk_engine", ["analyze"]),
        PlanNode("decide", "生成候选建议", "decision_maker", ["news", "risk"]),
        PlanNode("simulate", "模拟盘情景推演", "whatif_evaluator", ["decide"]),
        PlanNode("gate", "确定性风控闸门", "risk_gate", ["decide"]),
    ]
    if intent.name == "execute":
        nodes.append(PlanNode("approval", "强验证与用户确认", "approval_manager", ["simulate", "gate"]))
    else:
        nodes.append(PlanNode("respond", "输出诊断与建议", "response_builder", ["simulate", "gate"]))
    return TaskPlan(intent.name, nodes)
