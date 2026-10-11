"""银行 AI 智能体 · 六场景扩展（转账/账单/订阅/卡片/跨场景联动）。

理财场景保持既有 Orchestrator 闭环不动；本包为其余场景提供
确定性路由、域闸门与权限分级。统一入口：agent.banking.router.route()。
"""
from agent.banking.router import detect_scenario, route, build_scenario_plan
from agent.banking.tiers import tier_of_operation, tier_label, tier_policy

__all__ = [
    "detect_scenario", "route", "build_scenario_plan",
    "tier_of_operation", "tier_label", "tier_policy",
]
