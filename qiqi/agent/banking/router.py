"""银行 AI 智能体 · 六场景统一路由与执行入口（2026-10-11）。

职责：
  1. 注入检测先行（与理财路径同一道防线：memory_guard + 权限绕过模式）；
  2. 闭集场景路由：wealth / transfer / bill / subscription / card / cross_scene / 越界；
  3. 统一产出 ScenarioResult（含场景 DAG、权限级别、审计动作），Web 层直接渲染。

理财（wealth）不在本路由内执行——它走既有 Orchestrator 闭环（深度旗舰，
任何改动都可能破坏 14 项回归测试与答辩叙事），本路由只负责把理财请求
原样交回。其余五个场景在本模块内确定性执行。
"""
from __future__ import annotations

import re
from datetime import datetime

from agent.risk.memory_guard import check_content
from agent.risk.circuit_breaker import get_breaker
from agent.risk.audit import log_action
from contracts.banking import (
    BankCard, BillRecord, Contact, ScenarioResult,
)
from agent.banking import bills, cards, cross_scene, subscriptions, transfers
from agent.banking.tiers import tier_of_operation

SCENARIO_LABELS = {
    "wealth": "理财操作",
    "transfer": "智能转账",
    "bill": "账单分析",
    "subscription": "订阅/代扣管理",
    "card": "卡片管理",
    "cross_scene": "跨场景联动",
}

_PRIVILEGE_BYPASS_RE = re.compile(
    r"(绕过|跳过|不要|无需|免去).{0,8}(验证|确认|审批|风控|权限)|"
    r"(直接|立刻).{0,8}(转账|挂失|取消|解挂).{0,8}(别问|不用确认|无需确认)",
    re.I,
)
_OUT_OF_SCOPE_RE = re.compile(
    r"(机票|酒店|外卖|天气|打车|游戏|考试|写代码|写\s*.{0,6}\s*(作文|文章|论文))"
)


def detect_scenario(text: str) -> str:
    """闭集场景路由：按关键词判定场景。

    优先级：跨场景联动（生日+订花/锁定）> 转账 > 卡片 > 订阅 > 账单 > 理财。
    理财放最后兜底，保证「理财旗舰」路径的既有语义不变。
    """
    if re.search(r"(生日|纪念日|周年)", text) and re.search(
        r"(订|买|送|准备|锁定|存|预留)", text
    ):
        return "cross_scene"
    if re.search(r"(转账|转给|汇款|打款|AA|分摊|平分|转\s*\d)", text):
        return "transfer"
    if re.search(r"(挂失|锁卡|解锁|解挂|额度|限额|信用卡|银行卡|尾号)", text):
        return "card"
    if re.search(r"(订阅|会员|自动续费|代扣|取消.*(会员|订阅)|续费)", text):
        return "subscription"
    if re.search(r"(账单|消费|流水|异常交易|花销|支出)", text):
        return "bill"
    return "wealth"


def route(
    text: str,
    *,
    bills_data: list[BillRecord] | None = None,
    cards_data: list[BankCard] | None = None,
    contacts: list[Contact] | None = None,
    balance: float = 0.0,
    daily_cumulative: float = 0.0,
    user_id: str = "demo_user",
) -> ScenarioResult:
    """统一入口：检测 → 路由 → 场景执行 → 审计。"""
    question = (text or "").strip()[:500]
    if not question:
        return ScenarioResult(
            scenario="wealth", scenario_label=SCENARIO_LABELS["wealth"],
            intent={"name": "insufficient", "label": "需要澄清"},
            plan={"intent": "insufficient", "nodes": []},
            tier="green", status="done",
            message="请说一句话描述你要办的事，例如「这个月账单分析」或「给陈大黄转 500 元」。",
        )

    # 1. 注入与权限绕过检测（所有场景同一道防线）
    injection_reason = check_content(question)
    if injection_reason or _PRIVILEGE_BYPASS_RE.search(question):
        reason = injection_reason or "检测到绕过确认、验证或风控的请求"
        log_action("banking_request_blocked", user_id, "", {
            "question": question, "reason": reason,
        }, "failure")
        return ScenarioResult(
            scenario="unsafe", scenario_label="可疑请求",
            intent={"name": "unsafe", "label": "可疑请求", "blocked": True},
            plan={"intent": "unsafe", "nodes": []},
            tier="blocked", status="blocked",
            message=f"请求已被安全策略拦截：{reason}。权限规则不会因自然语言而改变。",
        )

    if _OUT_OF_SCOPE_RE.search(question):
        return ScenarioResult(
            scenario="out_of_scope", scenario_label="超出银行场景",
            intent={"name": "out_of_scope", "label": "超出银行场景"},
            plan={"intent": "out_of_scope", "nodes": []},
            tier="green", status="done",
            message="银行 AI 智能体只办理银行业务：转账、账单、理财、卡片、订阅与跨场景联动。",
        )

    scenario = detect_scenario(question)
    label = SCENARIO_LABELS[scenario]
    plan = build_scenario_plan(scenario)

    # 2. 场景执行（确定性）
    result: ScenarioResult
    if scenario == "transfer":
        result = _run_transfer(question, contacts or [], balance, daily_cumulative, plan, label)
    elif scenario == "bill":
        result = _run_bill(question, bills_data or [], plan, label)
    elif scenario == "subscription":
        result = _run_subscription(question, bills_data or [], plan, label)
    elif scenario == "card":
        result = _run_card(question, cards_data or [], plan, label)
    elif scenario == "cross_scene":
        result = _run_cross_scene(question, user_id, plan, label)
    else:
        # 理财：交回既有 Orchestrator 闭环，本路由不代执行
        result = ScenarioResult(
            scenario="wealth", scenario_label=label,
            intent={"name": "wealth", "label": "理财操作", "question": question},
            plan=plan, tier="green", status="delegated",
            message="已转交理财旗舰闭环处理（组合体检 → 风控闸门 → 情景推演 → 确认执行）。",
        )

    # 3. 审计（所有场景统一留痕）
    for action, detail in result.audit_actions:
        try:
            log_action(action, user_id, "", detail, "success")
        except Exception:      # noqa: BLE001
            pass
    return result


def build_scenario_plan(scenario: str) -> dict:
    """场景任务 DAG（与 agent/core/planner.py 风格一致的节点表达）。"""
    plans = {
        "transfer": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("payee", "收款人核验（通讯录）", "contact_check", ["validate"]),
            ("gate", "转账确定性闸门", "transfer_gate", ["payee"]),
            ("tier", "权限分级判定", "tier_router", ["gate"]),
            ("execute", "执行/待确认/定时任务", "transfer_executor", ["tier"]),
        ],
        "bill": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("period", "解析账单周期", "period_parser", ["validate"]),
            ("aggregate", "分类统计与聚合", "bill_aggregator", ["period"]),
            ("anomaly", "异常交易识别", "anomaly_detector", ["aggregate"]),
            ("report", "生成账单报告", "report_builder", ["anomaly"]),
        ],
        "subscription": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("detect", "订阅/代扣自动识别", "subscription_detector", ["validate"]),
            ("remind", "续费提醒扫描", "renewal_scanner", ["detect"]),
            ("gate", "取消操作闸门", "subscription_gate", ["detect"]),
            ("respond", "输出订阅清单/提醒/待确认", "response_builder", ["remind", "gate"]),
        ],
        "card": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("locate", "定位卡片", "card_locator", ["validate"]),
            ("gate", "卡片操作闸门", "card_gate", ["locate"]),
            ("tier", "权限分级判定", "tier_router", ["gate"]),
            ("execute", "执行/待确认", "card_executor", ["tier"]),
        ],
        "cross_scene": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("detect", "识别隐含意图与要素", "cross_detector", ["validate"]),
            ("memory", "生日信息写入记忆", "memory_store", ["detect"]),
            ("lock", "锁定活期资金", "savings_lock", ["memory"]),
            ("order", "生日前 2 天订花订蛋糕", "external_order", ["memory"]),
            ("remind", "提醒计划", "reminder", ["memory"]),
        ],
        "wealth": [
            ("validate", "校验输入与权限", "intent_router", []),
            ("market", "读取持仓与行情", "market_fetcher", ["validate"]),
            ("analyze", "组合诊断", "portfolio_analyzer", ["market"]),
            ("risk", "风险与适当性检查", "risk_engine", ["analyze"]),
            ("decide", "生成候选建议", "decision_maker", ["risk"]),
            ("gate", "确定性风控闸门", "risk_gate", ["decide"]),
            ("confirm", "强验证与用户确认", "approval_manager", ["gate"]),
        ],
    }
    nodes = []
    for nid, nlabel, ntool, ndeps in plans.get(scenario, []):
        status = "pending"
        if nid == "validate":
            status = "done"
        nodes.append({
            "id": nid, "label": nlabel, "tool": ntool,
            "depends_on": list(ndeps), "status": status,
        })
    return {"intent": scenario, "nodes": nodes}


def mark_plan(plan: dict, node_id: str, status: str) -> None:
    for node in plan.get("nodes", []):
        if node["id"] == node_id and node["status"] == "pending":
            node["status"] = status


def finish_plan(plan: dict, terminal_status: str = "done") -> None:
    """把执行后仍 pending 的节点按终端状态收口（审计用途，非假动画）。"""
    for node in plan.get("nodes", []):
        if node["status"] == "pending":
            node["status"] = terminal_status


# ============================================================
#  各场景执行
# ============================================================


def _run_transfer(question, contacts, balance, daily_cumulative, plan, label) -> ScenarioResult:
    res = transfers.handle_transfer(question, contacts, balance, daily_cumulative)
    mark_plan(plan, "validate", "done")
    mark_plan(plan, "payee", "done")
    mark_plan(plan, "gate", "blocked" if res.tier == "blocked" else "done")
    mark_plan(plan, "tier", "blocked" if res.tier == "blocked" else "done")
    if res.status == "scheduled":
        finish_plan(plan, "scheduled")
    elif res.tier == "blocked":
        finish_plan(plan, "skipped")
    else:
        finish_plan(plan, "done")
    return ScenarioResult(
        scenario="transfer", scenario_label=label,
        intent={"name": "transfer", "label": "智能转账",
                "question": question, "slots": {
                    "payee": res.request.payee, "amount": res.request.amount,
                    "memo": res.request.memo, "scheduled_at": res.request.scheduled_at,
                    "aa_participants": len(res.request.aa_participants),
                }},
        plan=plan, tier=res.tier, status=res.status,
        data={
            "request": {
                "payee": res.request.payee, "amount": res.request.amount,
                "memo": res.request.memo, "scheduled_at": res.request.scheduled_at,
                "matched_contact": (
                    {"name": res.matched_contact.name, "phone": res.matched_contact.phone}
                    if res.matched_contact else None
                ),
            },
            "gate_checks": res.gate_checks,
            "aa_items": res.aa_items,
            "daily_cumulative": res.daily_cumulative,
        },
        message=res.message,
        audit_actions=[("banking_transfer_review", {
            "question": question, "tier": res.tier, "status": res.status,
            "amount": res.request.amount, "payee": res.request.payee,
        })],
    )


def _run_bill(question, bills_data, plan, label) -> ScenarioResult:
    period = bills.parse_bill_period(question)
    report = bills.analyze_period(bills_data, period)
    mark_plan(plan, "validate", "done")
    mark_plan(plan, "period", "done")
    mark_plan(plan, "aggregate", "done")
    mark_plan(plan, "anomaly", "done")
    mark_plan(plan, "report", "done")
    return ScenarioResult(
        scenario="bill", scenario_label=label,
        intent={"name": "bill", "label": "账单分析", "question": question,
                "slots": {"period": period}},
        plan=plan, tier="green", status="done",
        data={
            "period": report.period,
            "total_spend": report.total_spend,
            "transaction_count": report.transaction_count,
            "by_category": report.by_category,
            "top_merchants": [{"merchant": m, "amount": v} for m, v in report.top_merchants],
            "anomalies": [{"rule": a.rule, "severity": a.severity, "detail": a.detail}
                          for a in report.anomalies],
            "insights": report.insights,
            "generated_at": report.generated_at,
        },
        message=f"{period} 账单分析完成：共 {report.transaction_count} 笔支出，"
                f"合计 {report.total_spend:,.2f} 元"
                + (f"，标记 {len(report.anomalies)} 条异常。" if report.anomalies else "。"),
        audit_actions=[("banking_bill_report", {"period": period,
                                                "count": report.transaction_count})],
    )


def _run_subscription(question, bills_data, plan, label) -> ScenarioResult:
    subs = subscriptions.detect_subscriptions(bills_data)
    active = [s for s in subs if s.status == "active"]
    reminders = subscriptions.renewal_reminders(active)
    mark_plan(plan, "validate", "done")
    mark_plan(plan, "detect", "done")
    mark_plan(plan, "remind", "done")

    cancel_target = subscriptions.find_subscription(active, question) \
        if re.search(r"(取消|退订|停止|关了|不要了)", question) else None
    if cancel_target:
        from agent.banking.gates import check_subscription_cancel
        passed, checks = check_subscription_cancel(cancel_target)
        mark_plan(plan, "gate", "done" if passed else "blocked")
        mark_plan(plan, "respond", "blocked" if not passed else "done")
        if not passed:
            return ScenarioResult(
                scenario="subscription", scenario_label=label,
                intent={"name": "subscription", "label": "订阅/代扣管理",
                        "question": question, "slots": {"cancel": cancel_target.merchant}},
                plan=plan, tier="blocked", status="blocked",
                data={"gate_checks": checks},
                message="；".join(c["detail"] for c in checks
                                  if not c["passed"] and c["severity"] == "block"),
                audit_actions=[("banking_subscription_cancel_blocked", {
                    "merchant": cancel_target.merchant,
                })],
            )
        return ScenarioResult(
            scenario="subscription", scenario_label=label,
            intent={"name": "subscription", "label": "订阅/代扣管理",
                    "question": question, "slots": {"cancel": cancel_target.merchant}},
            plan=plan, tier="yellow", status="pending_confirmation",
            data={
                "target": {"merchant": cancel_target.merchant,
                           "amount": cancel_target.amount,
                           "next_charge_at": cancel_target.next_charge_at},
                "gate_checks": checks,
            },
            message=f"已生成取消订阅请求：{cancel_target.merchant}（{cancel_target.amount:,.2f} 元/"
                    f"{'月' if cancel_target.cadence == 'monthly' else '年'}），"
                    f"下次扣费 {cancel_target.next_charge_at}。黄色权限：需确认后生效。",
            audit_actions=[("banking_subscription_cancel_requested", {
                "merchant": cancel_target.merchant, "amount": cancel_target.amount,
            })],
        )

    finish_plan(plan, "done")
    return ScenarioResult(
        scenario="subscription", scenario_label=label,
        intent={"name": "subscription", "label": "订阅/代扣管理", "question": question},
        plan=plan, tier="green", status="done",
        data={
            "subscriptions": [{
                "sub_id": s.sub_id, "merchant": s.merchant, "amount": s.amount,
                "cadence": s.cadence, "next_charge_at": s.next_charge_at,
                "first_seen_at": s.first_seen_at, "last_charge_at": s.last_charge_at,
                "status": s.status, "due_soon": s.due_soon(),
            } for s in subs],
            "renewal_reminders": [{"merchant": s.merchant, "amount": s.amount,
                                   "next_charge_at": s.next_charge_at}
                                  for s in reminders],
        },
        message=f"识别出 {len(active)} 个生效中的订阅/代扣"
                + (f"，其中 {len(reminders)} 个将在 7 天内扣费，请留意续费提醒。" if reminders else "。"),
        audit_actions=[("banking_subscription_scan", {"active": len(active),
                                                      "reminders": len(reminders)})],
    )


def _run_card(question, cards_data, plan, label) -> ScenarioResult:
    res = cards.handle_card_action(question, cards_data)
    mark_plan(plan, "validate", "done")
    mark_plan(plan, "locate", "blocked" if res.tier == "blocked" else "done")
    mark_plan(plan, "gate", "blocked" if res.tier == "blocked" else "done")
    mark_plan(plan, "tier", "blocked" if res.tier == "blocked" else "done")
    finish_plan(plan, "done" if res.tier != "blocked" else "skipped")
    card = cards.find_card(cards_data, question)
    return ScenarioResult(
        scenario="card", scenario_label=label,
        intent={"name": "card", "label": "卡片管理", "question": question,
                "slots": {"operation": res.operation,
                          "card_last4": card.last4 if card else ""}},
        plan=plan, tier=res.tier, status=res.status,
        data={
            "operation": res.operation,
            "card": ({"last4": card.last4, "bank": card.bank, "card_type": card.card_type,
                      "status": card.status, "credit_limit": card.credit_limit,
                      "daily_txn_limit": card.daily_txn_limit} if card else None),
            "gate_checks": res.gate_checks,
        },
        message=res.message,
        audit_actions=[("banking_card_action", {
            "operation": res.operation, "tier": res.tier, "status": res.status,
            "card_last4": card.last4 if card else "",
        })],
    )


def _run_cross_scene(question, user_id, plan, label) -> ScenarioResult:
    result_plan = cross_scene.build_cross_scene_plan(question)
    mark_plan(plan, "validate", "done")
    mark_plan(plan, "detect", "done")
    if result_plan.steps:
        for step in result_plan.steps:
            mark_plan(plan, step["id"], step["status"])

    # 生日信息写入 fact 层（source=user_statement，标注待用户确认；
    # USER 层直写会被写入门卫拒绝——那是防投毒设计，这里不绕过）
    birthday = ""
    for step in result_plan.steps:
        if step["id"] == "detect":
            m = re.search(r"(\d{4}-\d{2}-\d{2})", step["detail"])
            birthday = m.group(1) if m else ""
    memory_note = ""
    if birthday:
        try:
            from agent.tools.memory_tools import memory_retain
            memory_retain(
                user_id, "fact",
                f"家人生日（用户口述，待确认）：{birthday}",
                source="user_statement",
                tags=["family_event", "birthday"],
            )
            memory_note = f"已把生日 {birthday} 记入长期记忆（fact 层，标记待用户确认）。"
        except Exception as exc:      # noqa: BLE001
            memory_note = f"记忆写入未完成：{exc}"

    return ScenarioResult(
        scenario="cross_scene", scenario_label=label,
        intent={"name": "cross_scene", "label": "跨场景联动", "question": question,
                "slots": {"birthday": birthday}},
        plan=plan, tier="green", status="pending_confirmation" if result_plan.pending_confirmations else "done",
        data={
            "plan": {
                "plan_id": result_plan.plan_id,
                "summary": result_plan.summary,
                "steps": result_plan.steps,
                "memory_writes": result_plan.memory_writes,
                "scheduled": result_plan.scheduled,
                "pending_confirmations": result_plan.pending_confirmations,
                "caveats": result_plan.caveats,
            },
        },
        message=result_plan.summary + (" " + memory_note if memory_note else ""),
        audit_actions=[("banking_cross_scene_plan", {
            "question": question, "birthday": birthday,
            "steps": len(result_plan.steps),
        })],
    )
