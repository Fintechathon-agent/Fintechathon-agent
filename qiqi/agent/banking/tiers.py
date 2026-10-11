"""六场景权限分级映射——对齐赛题「权限分级机制」表。

赛题原文表：
  绿：余额查询、交易记录查询、账单分析、理财收益查询等纯查询类 → 确认意图后自动执行
  黄：小额转账（日累计 ≤1000 元）、订阅查询/取消、虚拟卡申请等 → 展示详情 + 明确确认
  红：大额转账（日累计 >1000 元）、密码修改、卡片挂失/解挂、理财产品申购等 → 多因子强验证

本模块是权限判定的唯一权威来源（single source of truth），
Web 层与场景执行层都必须调 tier_of()，不得各写一套判定。
口径与 Vesper（风控）一致：先闸门（blocked 优先于一切），再按操作类型定绿黄红。
"""
from __future__ import annotations

from contracts.banking import Tier

# 黄色转账单日累计上限（赛题硬线）
YELLOW_TRANSFER_DAILY_CAP = 1000.0


def tier_of_operation(scenario: str, operation: str, amount: float = 0.0,
                      daily_cumulative: float = 0.0) -> Tier:
    """按场景+操作返回权限级别。

    参数：
      scenario:   wealth / transfer / bill / subscription / card / cross_scene
      operation:  场景内具体操作（transfer_now / transfer_schedule / aa_split /
                  bill_report / bill_query / sub_query / sub_cancel / card_query /
                  card_limit_adjust / card_lock / card_unlock / card_loss_report /
                  wealth_query / wealth_trade / cross_lock_savings / cross_order）
      amount:     本笔金额（元）
      daily_cumulative: 当日已累计转账金额（元）
    """
    if scenario == "transfer":
        if operation in ("transfer_query",):
            return "green"
        # 日累计口径：本笔 + 当日已累计 超过 1000 元 → 红
        if amount + daily_cumulative > YELLOW_TRANSFER_DAILY_CAP:
            return "red"
        return "yellow"

    if scenario == "bill":
        return "green"

    if scenario == "subscription":
        if operation == "sub_cancel":
            return "yellow"
        return "green"

    if scenario == "card":
        op = operation.replace("card_", "")
        if op == "loss_report":
            return "red"
        if op in ("limit_adjust", "lock", "unlock"):
            return "yellow"
        return "green"

    if scenario == "wealth":
        if operation == "wealth_trade":
            return "red"
        return "green"

    if scenario == "cross_scene":
        # 联动计划整体为「方案」，真正执行到资金/外部动作时按子步骤权限走；
        # 计划生成本身是绿色查询类，锁定活期与下单在子步骤中分别黄/红。
        return "green"

    return "green"


def tier_label(tier: Tier) -> str:
    return {
        "green": "绿色权限 · 自动执行",
        "yellow": "黄色权限 · 确认后执行",
        "red": "红色权限 · 强验证后执行",
        "blocked": "风控拦截 · 不可执行",
    }.get(tier, tier)


def tier_policy(tier: Tier) -> str:
    from contracts.banking import TIER_POLICY
    return TIER_POLICY.get(tier, "")
