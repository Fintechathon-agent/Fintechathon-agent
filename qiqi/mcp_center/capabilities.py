"""MCP 能力注册表——业务系统逆向蒸馏的单一事实源。

每一项 Capability 都是对既有业务能力的一次「逆向建模」：

    业务入口（页面 / HTTP / 自然语言路由）
        → 原子能力（动词 + 对象 + 槽位）
        → 契约（JSON Schema / 输出结构）
        → 治理（权限级别 / 是否需人工确认 / 审计动作）
        → MCP 工具描述（tools/list）

设计红线：
  · MCP 只暴露「发起业务请求」与「读取业务事实」两类能力；
  · 资金/卡片/订阅/跨场景动作一律只写入待确认队列，由前端平台的人审
    界面确认后才执行——审批能力不得成为 Agent 可调用的工具；
  · 所有调用走既有确定性闸门与审计，不另建执行旁路。
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from agent.banking import bills as bills_module
from agent.banking import cards as cards_module
from agent.banking import subscriptions as subscriptions_module
from agent.risk.audit import get_audit_logger
from agent.risk.circuit_breaker import get_breaker
from contracts.banking import TIER_POLICY
from web.banking_demo import (
    demo_bills,
    demo_contacts,
    get_banking_state,
)
from web.banking_service import run_scenario

USER_ID = "demo_user"
PROTOCOL_LATEST = "2025-06-18"
PROTOCOL_SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")

DEMO_PROVENANCE = {
    "source": "demo_fixture",
    "source_label": "演示固定数据",
    "simulation_notice": "演示模拟：不会发生真实资金转移、短信/人脸验证或外部下单。",
}


class CapabilityInputError(ValueError):
    """工具入参不符合业务前置条件；由 MCP 层转成 isError=true 的工具结果。"""


@dataclass(frozen=True)
class Capability:
    name: str
    title: str
    description: str
    kind: str                    # query / action / plan
    tier: str                    # green / yellow / red
    input_schema: dict
    handler: Callable[[dict], dict]
    source: str                  # 逆向建模来源（文件#函数）
    output_schema: dict | None = None
    examples: list[dict] = field(default_factory=list)

    @property
    def requires_human_confirmation(self) -> bool:
        return self.kind != "query"

    def tool_descriptor(self) -> dict:
        annotations = {
            "title": self.title,
            "readOnlyHint": self.kind == "query",
            # 动作工具不会直接落账，但确认后会改变真实业务状态，按破坏性提示处理。
            "destructiveHint": self.kind != "query",
            "idempotentHint": self.kind == "query",
            "openWorldHint": False,
        }
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "outputSchema": self.output_schema or {"type": "object", "additionalProperties": True},
            "annotations": annotations,
            "_meta": {
                "tier": self.tier,
                "kind": self.kind,
                "source": self.source,
                "requiresHumanConfirmation": self.requires_human_confirmation,
                "confirmationChannel": "frontend_platform" if self.requires_human_confirmation else None,
                "examples": self.examples,
            },
        }


def _provenance() -> dict:
    return {**DEMO_PROVENANCE, "as_of": datetime.now().strftime("%Y-%m-%d")}


def _num(value: Any, field_name: str, *, minimum: float = 0.0, maximum: float = 1e12) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CapabilityInputError(f"{field_name} 必须是数字")
    number = float(value)
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise CapabilityInputError(f"{field_name} 超出可办理范围")
    return round(number, 2)


def _text(value: Any, field_name: str, *, max_length: int = 200, required: bool = True) -> str:
    text = str(value or "").strip()
    if not text:
        if required:
            raise CapabilityInputError(f"缺少 {field_name}")
        return ""
    if len(text) > max_length:
        raise CapabilityInputError(f"{field_name} 过长（最多 {max_length} 字）")
    return text


def _iso_or_empty(value: Any, field_name: str) -> str:
    text = _text(value, field_name, max_length=32, required=False)
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise CapabilityInputError(f"{field_name} 须为 ISO 时间，例如 2026-10-20 14:30") from exc
    if parsed <= datetime.now():
        raise CapabilityInputError(f"{field_name} 必须晚于当前时间")
    return parsed.isoformat(timespec="minutes")


def _period(value: Any) -> str:
    text = _text(value, "period", max_length=24, required=False)
    now = datetime.now()
    if not text or text in ("current_month", "this_month", "本月", "这个月"):
        return now.strftime("%Y-%m")
    if text in ("current_year", "this_year", "今年", "本年"):
        return now.strftime("%Y")
    if re.fullmatch(r"\d{4}", text):
        return text
    month_match = re.fullmatch(r"(\d{4})-(\d{2})", text)
    if month_match and 1 <= int(month_match.group(2)) <= 12:
        return text
    raise CapabilityInputError("period 须为 YYYY-MM、YYYY、current_month 或 current_year")


def _pending_ids_since(before_ids: set[str], result_body: dict) -> list[str]:
    """从 run_scenario 返回的队列中定位本次产生的待确认项（含去重命中）。"""
    after = result_body.get("pending") or []
    new = [p for p in after if p.get("id") not in before_ids]
    if new:
        return [p["id"] for p in new]
    res = result_body.get("result") or {}
    request = (res.get("data") or {}).get("request") or {}
    matched = []
    for item in after:
        payload = item.get("payload") or {}
        item_request = payload.get("request") or {}
        same_scenario = item.get("scenario") == res.get("scenario")
        same_tier = item.get("tier") == res.get("tier")
        if request.get("operation") == "aa_collect":
            same_request = item_request.get("operation") == "aa_collect"
        else:
            same_request = (
                item_request.get("payee") == request.get("payee")
                and float(item_request.get("amount") or 0) == float(request.get("amount") or 0)
            )
        if same_scenario and same_tier and same_request:
            matched.append(item["id"])
    return matched


def _queue_response(result_body: dict) -> dict:
    """把 Web 服务层的运行结果翻译成 Agent 可消费、但不可确认的结果信封。"""
    if result_body.get("delegated"):
        return {
            "message": result_body.get("message", ""),
            "status": "delegated",
            "tier": "green",
            "pending_ids": [],
            "next_action": "handoff_to_wealth_pipeline",
            "handoff_endpoint": "/api/review",
            "provenance": result_body.get("provenance") or _provenance(),
        }

    res = result_body.get("result") or {}
    pending_ids = _pending_ids_since(
        set(result_body.get("_before_pending_ids") or []), result_body
    )
    pending = [
        {
            "id": p.get("id"),
            "scenario": p.get("scenario"),
            "tier": p.get("tier"),
            "message": p.get("message"),
            "created_at": p.get("created_at"),
            "expires_at": p.get("expires_at"),
            "payload": p.get("payload"),
        }
        for p in (result_body.get("pending") or [])
        if p.get("id") in pending_ids
    ]
    status = res.get("status", "unknown")
    return {
        "message": res.get("message", ""),
        "status": status,
        "tier": res.get("tier", "green"),
        "scenario": res.get("scenario"),
        "scenario_label": res.get("scenario_label"),
        "pending_ids": pending_ids,
        "pending": pending,
        "next_action": (
            "human_confirmation_required"
            if status in ("pending_confirmation", "scheduled")
            else "none"
        ),
        "confirmation_endpoint": "/api/scenarios/confirm",
        "confirmation_policy": (
            "确认/强验证只能由前端平台的人审界面发起；MCP 不提供 confirm 工具。"
        ),
        "data": res.get("data") or {},
        "deduplicated": bool(result_body.get("deduplicated")),
        "provenance": result_body.get("provenance") or _provenance(),
    }


def _run_question(question: str) -> dict:
    """走业务系统原有统一入口；MCP 不复制路由与闸门逻辑。"""
    state = get_banking_state()
    before = {p.get("id") for p in state.pending}
    body = run_scenario(question)
    body["_before_pending_ids"] = sorted(before)
    return _queue_response(body)


# ============================================================
#  查询类能力（绿：直接读取，不改业务状态）
# ============================================================


def account_overview(args: dict) -> dict:
    state = get_banking_state()
    state.refresh_day()
    subscriptions = state.subscriptions(demo_bills())
    active = [s for s in subscriptions if s.status == "active"]
    reminders = subscriptions_module.renewal_reminders(active)
    waiting = [t for t in state.scheduled if t.get("status") == "waiting_due"]
    return {
        "message": (
            f"可用余额 {state.balance:,.2f} 元；今日已累计转账 {state.daily_cumulative:,.2f} 元；"
            f"{len(state.cards)} 张卡、{len(active)} 个生效订阅、"
            f"{len(state.pending)} 条待确认、{len(waiting)} 条定时任务。"
        ),
        "balance": round(state.balance, 2),
        "daily_cumulative": round(state.daily_cumulative, 2),
        "cards": [{
            "card_id": c.card_id, "last4": c.last4, "bank": c.bank,
            "card_type": c.card_type, "status": c.status,
            "credit_limit": c.credit_limit, "daily_txn_limit": c.daily_txn_limit,
        } for c in state.cards],
        "subscriptions": [{
            "sub_id": s.sub_id, "merchant": s.merchant, "amount": s.amount,
            "cadence": s.cadence, "next_charge_at": s.next_charge_at,
            "status": s.status, "due_soon": s.due_soon(),
        } for s in subscriptions],
        "renewal_reminders": [{
            "merchant": s.merchant, "amount": s.amount, "next_charge_at": s.next_charge_at,
        } for s in reminders],
        "pending_count": len(state.pending),
        "scheduled_count": len(waiting),
        "breaker": get_breaker().state(),
        "provenance": _provenance(),
    }


def bill_analyze(args: dict) -> dict:
    period = _period(args.get("period"))
    report = bills_module.analyze_period(demo_bills(), period)
    return {
        "message": (
            f"{period} 账单分析完成：共 {report.transaction_count} 笔支出，"
            f"合计 {report.total_spend:,.2f} 元"
            + (f"，标记 {len(report.anomalies)} 条异常。" if report.anomalies else "。")
        ),
        "period": report.period,
        "total_spend": report.total_spend,
        "transaction_count": report.transaction_count,
        "by_category": report.by_category,
        "top_merchants": [{"merchant": m, "amount": v} for m, v in report.top_merchants],
        "anomalies": [{
            "rule": a.rule, "severity": a.severity, "tx_id": a.tx_id, "detail": a.detail,
        } for a in report.anomalies],
        "insights": report.insights,
        "generated_at": report.generated_at,
        "provenance": _provenance(),
    }


def subscription_list(args: dict) -> dict:
    include_cancelled = bool(args.get("include_cancelled", True))
    state = get_banking_state()
    subs = state.subscriptions(demo_bills())
    visible = subs if include_cancelled else [s for s in subs if s.status == "active"]
    reminders = subscriptions_module.renewal_reminders(
        [s for s in subs if s.status == "active"]
    )
    active = [s for s in subs if s.status == "active"]
    return {
        "message": f"识别出 {len(active)} 个生效中的订阅/代扣"
                   + (f"，其中 {len(reminders)} 个将在 7 天内扣费。" if reminders else "。"),
        "subscriptions": [{
            "sub_id": s.sub_id, "merchant": s.merchant, "amount": s.amount,
            "cadence": s.cadence, "next_charge_at": s.next_charge_at,
            "first_seen_at": s.first_seen_at, "last_charge_at": s.last_charge_at,
            "status": s.status, "due_soon": s.due_soon(),
            "evidence_tx_ids": s.evidence_tx_ids,
        } for s in visible],
        "renewal_reminders": [{
            "merchant": s.merchant, "amount": s.amount, "next_charge_at": s.next_charge_at,
        } for s in reminders],
        "provenance": _provenance(),
    }


def card_list(args: dict) -> dict:
    state = get_banking_state()
    last4 = _text(args.get("last4"), "last4", max_length=4, required=False)
    if last4 and not re.fullmatch(r"\d{4}", last4):
        raise CapabilityInputError("last4 须为 4 位数字")
    cards = [c for c in state.cards if not last4 or c.last4 == last4]
    if last4 and not cards:
        raise CapabilityInputError(f"未找到尾号 {last4} 的卡片")
    return {
        "message": f"共找到 {len(cards)} 张卡。",
        "cards": [{
            "card_id": c.card_id, "last4": c.last4, "bank": c.bank,
            "card_type": c.card_type, "status": c.status,
            "credit_limit": c.credit_limit, "daily_txn_limit": c.daily_txn_limit,
        } for c in cards],
        "provenance": _provenance(),
    }


def pending_list(args: dict) -> dict:
    include_scheduled = bool(args.get("include_scheduled", True))
    include_expired = bool(args.get("include_expired", False))
    state = get_banking_state()
    now = datetime.now()

    def expired(item: dict) -> bool:
        try:
            return datetime.fromisoformat(str(item.get("expires_at"))) <= now
        except (TypeError, ValueError):
            return False

    pending = [p for p in state.pending if include_expired or not expired(p)]
    scheduled = [
        {
            "id": t.get("id"), "scheduled_at": t.get("scheduled_at"),
            "status": t.get("status"), "scenario": (t.get("item") or {}).get("scenario"),
            "tier": (t.get("item") or {}).get("tier"),
            "message": (t.get("item") or {}).get("message"),
        }
        for t in state.scheduled
        if include_scheduled and t.get("status") == "waiting_due"
    ]
    return {
        "message": f"当前有 {len(pending)} 条待确认、{len(scheduled)} 条定时任务。",
        "pending": pending,
        "scheduled": scheduled,
        "confirmation_endpoint": "/api/scenarios/confirm",
        "confirmation_policy": "MCP 只能读取队列；确认与强验证必须由人审界面发起。",
        "provenance": _provenance(),
    }


def audit_timeline(args: dict) -> dict:
    raw_limit = args.get("limit", 20)
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as exc:
        raise CapabilityInputError("limit 须为整数") from exc
    limit = max(1, min(limit, 200))
    action_filter = _text(args.get("action"), "action", max_length=80, required=False)

    directory = get_audit_logger().dir
    entries: list[dict] = []
    for path in sorted(directory.glob("audit_*.jsonl"), reverse=True):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if action_filter and entry.get("action") != action_filter:
                continue
            entries.append(entry)
        if len(entries) >= limit:
            break
    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    entries = entries[:limit]
    return {
        "message": f"返回最近 {len(entries)} 条审计记录。",
        "entries": entries,
        "limit": limit,
        "action": action_filter,
    }


def capability_catalog(args: dict) -> dict:
    descriptors = [c.tool_descriptor() for c in CAPABILITIES.values()]
    kinds = {kind: sum(1 for c in CAPABILITIES.values() if c.kind == kind)
             for kind in ("query", "action", "plan")}
    return {
        "message": (
            f"能力中心共 {len(descriptors)} 项能力："
            f"{kinds['query']} 项查询、{kinds['action']} 项动作、{kinds['plan']} 项计划。"
        ),
        "server": {
            "name": "finance-lab-mcp-capability-center",
            "version": "1.0.0",
            "protocol_version": PROTOCOL_LATEST,
        },
        "capabilities": descriptors,
        "counts": {"total": len(descriptors), **kinds},
        "confirmation": confirmation_policy(),
        "provenance": _provenance(),
    }


# ============================================================
#  动作/计划类能力（只入队，需前端平台人工确认）
# ============================================================


def scenario_run(args: dict) -> dict:
    question = _text(args.get("question"), "question", max_length=500)
    return _run_question(question)


def transfer_prepare(args: dict) -> dict:
    amount = _num(args.get("amount"), "amount", minimum=0.01)
    payee = _text(args.get("payee"), "payee", max_length=40, required=False)
    memo = _text(args.get("memo"), "memo", max_length=40, required=False)
    scheduled_at = _iso_or_empty(args.get("scheduled_at"), "scheduled_at")

    participants = args.get("aa_participants")
    if participants is not None:
        if isinstance(participants, bool) or not isinstance(participants, int):
            raise CapabilityInputError("aa_participants 须为 2-100 的整数")
        if not 2 <= participants <= 100:
            raise CapabilityInputError("aa_participants 须为 2-100 的整数")
        if scheduled_at:
            raise CapabilityInputError("AA 收款暂不支持预约")
        question = f"聚餐{amount:g}元AA，{participants}个人"
        operation = "aa_collect"
    else:
        if not payee:
            raise CapabilityInputError("缺少 payee（收款人姓名或手机号）")
        if re.search(r"备注", payee):
            raise CapabilityInputError("payee 不得包含指令文本")
        question = f"给{payee}转{amount:g}元"
        if memo:
            question += f"备注{memo}"
        if scheduled_at:
            question = f"定时 {scheduled_at} " + question
        operation = "transfer"

    result = _run_question(question)
    result["request"] = {
        "operation": operation,
        "payee": payee,
        "amount": amount,
        "memo": memo,
        "scheduled_at": scheduled_at,
        "aa_participants": participants or 0,
    }
    return result


def subscription_cancel(args: dict) -> dict:
    merchant = _text(args.get("merchant"), "merchant", max_length=40)
    return _run_question(f"取消{merchant}的订阅")


CARD_OPERATION_HINTS = {
    "lock": "锁定",
    "unlock": "解锁",
    "loss_report": "挂失",
    "loss_release": "解挂",
    "limit_adjust": "额度调整",
}


def card_action(args: dict) -> dict:
    last4 = _text(args.get("last4"), "last4", max_length=4)
    if not re.fullmatch(r"\d{4}", last4):
        raise CapabilityInputError("last4 须为 4 位数字")
    operation = _text(args.get("operation"), "operation", max_length=24)
    if operation not in (*CARD_OPERATION_HINTS, "query"):
        raise CapabilityInputError(
            "operation 须为 query / lock / unlock / loss_report / loss_release / limit_adjust"
        )

    state = get_banking_state()
    card = next((c for c in state.cards if c.last4 == last4), None)

    if operation == "query":
        result = cards_module.handle_card_action(f"尾号{last4}的卡状态", state.cards)
        return {
            "message": result.message,
            "status": result.status,
            "tier": result.tier,
            "scenario": "card",
            "operation": "query",
            "card": ({
                "card_id": card.card_id, "last4": card.last4, "bank": card.bank,
                "card_type": card.card_type, "status": card.status,
                "credit_limit": card.credit_limit, "daily_txn_limit": card.daily_txn_limit,
            } if card else None),
            "provenance": _provenance(),
        }

    if operation == "limit_adjust":
        new_limit = _num(args.get("new_limit"), "new_limit", minimum=0.01, maximum=1e9)
        question = f"尾号{last4}的信用卡额度调到{new_limit:g}元"
    elif operation == "loss_report":
        question = f"尾号{last4}的卡挂失"
    elif operation == "loss_release":
        question = f"尾号{last4}的卡解挂"
    else:
        question = f"{CARD_OPERATION_HINTS[operation]}尾号{last4}的卡"

    result = _run_question(question)
    result["card"] = ({
        "card_id": card.card_id, "last4": card.last4, "bank": card.bank,
        "card_type": card.card_type, "status": card.status,
    } if card else None)
    result["operation"] = operation
    return result


CROSS_SCENE_RELATIONS = {
    "爱人", "老婆", "老公", "妻子", "丈夫", "对象",
    "女朋友", "男朋友", "妈妈", "爸爸", "女儿", "儿子", "孩子", "家人", "朋友",
}


def cross_scene_plan(args: dict) -> dict:
    birthday = _text(args.get("birthday"), "birthday", max_length=10)
    try:
        birthday_dt = datetime.strptime(birthday, "%Y-%m-%d")
    except ValueError as exc:
        raise CapabilityInputError("birthday 须为 YYYY-MM-DD") from exc
    relation = _text(args.get("relation"), "relation", max_length=12, required=False) or "爱人"
    if relation not in CROSS_SCENE_RELATIONS:
        raise CapabilityInputError(
            "relation 须为：" + "、".join(sorted(CROSS_SCENE_RELATIONS))
        )
    lock_amount = _num(args.get("lock_amount", 0), "lock_amount", minimum=0.0)
    order_gifts = args.get("order_gifts", True)
    if not isinstance(order_gifts, bool):
        raise CapabilityInputError("order_gifts 必须是布尔值")

    parts = [f"{relation} {birthday_dt.month}月{birthday_dt.day}日生日"]
    if lock_amount > 0:
        parts.append(f"锁定{lock_amount:g}元活期")
    if order_gifts:
        parts.append("生日前2天订花和蛋糕")
    question = "，".join(parts)

    result = _run_question(question)
    result["request"] = {
        "relation": relation,
        "birthday": birthday,
        "lock_amount": lock_amount,
        "order_gifts": order_gifts,
    }
    return result


# ============================================================
#  注册表与对外清单
# ============================================================


_EMPTY_SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}


CAPABILITIES: dict[str, Capability] = {
    "banking_account_overview": Capability(
        name="banking_account_overview",
        title="账户总览",
        description="读取可用余额、今日累计转账、卡列表、订阅、待确认数量与熔断状态。纯查询，自动执行。",
        kind="query", tier="green",
        input_schema=_EMPTY_SCHEMA,
        output_schema={"type": "object", "additionalProperties": True},
        handler=account_overview,
        source="web/banking_service.py#scenario_overview + web/banking_demo.py#BankingState",
        examples=[{}],
    ),
    "banking_bill_analyze": Capability(
        name="banking_bill_analyze",
        title="账单分析",
        description="按月份或年份聚合消费、分类占比、Top 商户与异常交易。纯查询，自动执行。",
        kind="query", tier="green",
        input_schema={
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "description": "YYYY-MM、YYYY、current_month 或 current_year；默认当前月",
                },
            },
            "additionalProperties": False,
        },
        handler=bill_analyze,
        source="agent/banking/bills.py#analyze_period",
        examples=[{"period": "current_month"}],
    ),
    "banking_subscription_list": Capability(
        name="banking_subscription_list",
        title="订阅/代扣清单",
        description="识别周期性扣费，返回订阅详情、下次扣费与 7 天内续费提醒。纯查询。",
        kind="query", tier="green",
        input_schema={
            "type": "object",
            "properties": {
                "include_cancelled": {
                    "type": "boolean", "default": True,
                    "description": "是否包含已取消订阅",
                },
            },
            "additionalProperties": False,
        },
        handler=subscription_list,
        source="agent/banking/subscriptions.py#detect_subscriptions",
        examples=[{"include_cancelled": False}],
    ),
    "banking_card_list": Capability(
        name="banking_card_list",
        title="卡片清单",
        description="读取名下卡片、状态、额度与单日限额，可按尾号过滤。纯查询。",
        kind="query", tier="green",
        input_schema={
            "type": "object",
            "properties": {
                "last4": {"type": "string", "pattern": "^\\d{4}$", "description": "卡号后四位"},
            },
            "additionalProperties": False,
        },
        handler=card_list,
        source="agent/banking/cards.py#find_card",
        examples=[{"last4": "8888"}],
    ),
    "banking_pending_list": Capability(
        name="banking_pending_list",
        title="待确认队列",
        description="读取当前待确认事项与定时任务。只读；确认动作不在 MCP 工具面暴露。",
        kind="query", tier="green",
        input_schema={
            "type": "object",
            "properties": {
                "include_scheduled": {"type": "boolean", "default": True},
                "include_expired": {"type": "boolean", "default": False},
            },
            "additionalProperties": False,
        },
        handler=pending_list,
        source="web/banking_service.py#pending_list",
        examples=[{}],
    ),
    "banking_audit_timeline": Capability(
        name="banking_audit_timeline",
        title="审计时间线",
        description="读取最近审计事件，可按动作名过滤。纯查询。",
        kind="query", tier="green",
        input_schema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20},
                "action": {"type": "string", "description": "精确动作名，例如 mcp_tool_call"},
            },
            "additionalProperties": False,
        },
        handler=audit_timeline,
        source="agent/risk/audit.py#AuditLogger",
        examples=[{"limit": 20, "action": "mcp_tool_call"}],
    ),
    "banking_capability_catalog": Capability(
        name="banking_capability_catalog",
        title="能力目录",
        description="返回本 MCP Server 的全部能力、权限级别、来源映射与确认策略。",
        kind="query", tier="green",
        input_schema=_EMPTY_SCHEMA,
        handler=capability_catalog,
        source="mcp_center/capabilities.py#CAPABILITIES",
        examples=[{}],
    ),
    "banking_scenario_run": Capability(
        name="banking_scenario_run",
        title="自然语言业务入口",
        description=(
            "把一句自然语言交给既有六场景统一入口：自动路由、确定性闸门、权限分级；"
            "资金/卡片/订阅/联动动作只写入待确认队列，不直接执行。"
        ),
        kind="action", tier="yellow",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "minLength": 1, "maxLength": 500},
            },
            "required": ["question"],
            "additionalProperties": False,
        },
        handler=scenario_run,
        source="agent/banking/router.py#route",
        examples=[{"question": "给王芳转500元备注聚餐"}],
    ),
    "banking_transfer_prepare": Capability(
        name="banking_transfer_prepare",
        title="发起转账/AA 收款",
        description=(
            "结构化发起转账或 AA 收款请求。仅生成待确认事项；"
            "黄色需用户确认、红色需多因子强验证，均由前端平台完成。"
        ),
        kind="action", tier="yellow",
        input_schema={
            "type": "object",
            "properties": {
                "payee": {"type": "string", "maxLength": 40, "description": "收款人姓名或手机号；AA 时可省略"},
                "amount": {"type": "number", "exclusiveMinimum": 0, "maximum": 1e12},
                "memo": {"type": "string", "maxLength": 40},
                "scheduled_at": {
                    "type": "string",
                    "description": "ISO 时间（未来），例如 2026-10-20 14:30；AA 不支持预约",
                },
                "aa_participants": {
                    "type": "integer", "minimum": 2, "maximum": 100,
                    "description": "AA 参与人数；提供时生成多条收款请求",
                },
            },
            "required": ["amount"],
            "additionalProperties": False,
        },
        handler=transfer_prepare,
        source="agent/banking/transfers.py#handle_transfer + web/banking_service.py#_run_and_queue",
        examples=[
            {"payee": "王芳", "amount": 500, "memo": "聚餐"},
            {"amount": 300, "aa_participants": 3},
        ],
    ),
    "banking_subscription_cancel": Capability(
        name="banking_subscription_cancel",
        title="取消订阅/代扣",
        description="按商户名发起取消请求；黄色权限，只入队，需用户确认后生效。",
        kind="action", tier="yellow",
        input_schema={
            "type": "object",
            "properties": {
                "merchant": {"type": "string", "maxLength": 40, "description": "商户名，例如 超燃健身"},
            },
            "required": ["merchant"],
            "additionalProperties": False,
        },
        handler=subscription_cancel,
        source="agent/banking/subscriptions.py#find_subscription + web/banking_service.py#_run_and_queue",
        examples=[{"merchant": "超燃健身"}],
    ),
    "banking_card_action": Capability(
        name="banking_card_action",
        title="卡片操作",
        description=(
            "按尾号查询/锁定/解锁/调整额度/挂失/解挂。查询直接返回；"
            "其余只入队，黄色需确认、红色需强验证。"
        ),
        kind="action", tier="yellow",
        input_schema={
            "type": "object",
            "properties": {
                "last4": {"type": "string", "pattern": "^\\d{4}$"},
                "operation": {
                    "type": "string",
                    "enum": ["query", "lock", "unlock", "limit_adjust", "loss_report", "loss_release"],
                },
                "new_limit": {"type": "number", "exclusiveMinimum": 0, "maximum": 1e9,
                              "description": "仅 limit_adjust 使用"},
            },
            "required": ["last4", "operation"],
            "additionalProperties": False,
        },
        handler=card_action,
        source="agent/banking/cards.py#handle_card_action + web/banking_service.py#_run_and_queue",
        examples=[{"last4": "8888", "operation": "lock"}],
    ),
    "banking_cross_scene_plan": Capability(
        name="banking_cross_scene_plan",
        title="跨场景联动计划",
        description=(
            "根据家人生日生成联动计划：记忆写入、锁定活期（待确认）、生日前 2 天订花订蛋糕"
            "（Mock）。资金动作只入队。"
        ),
        kind="plan", tier="yellow",
        input_schema={
            "type": "object",
            "properties": {
                "birthday": {"type": "string", "description": "YYYY-MM-DD"},
                "relation": {"type": "string", "maxLength": 12, "default": "爱人"},
                "lock_amount": {"type": "number", "minimum": 0, "maximum": 1e9, "default": 0},
                "order_gifts": {"type": "boolean", "default": True},
            },
            "required": ["birthday"],
            "additionalProperties": False,
        },
        handler=cross_scene_plan,
        source="agent/banking/cross_scene.py#build_cross_scene_plan",
        examples=[{"birthday": "2026-10-25", "relation": "爱人", "lock_amount": 1000,
                   "order_gifts": True}],
    ),
}


def get_capability(name: str) -> Capability | None:
    return CAPABILITIES.get(name)


def confirmation_policy() -> dict:
    return {
        "exposed_as_tool": False,
        "human_in_the_loop": True,
        "endpoint": "/api/scenarios/confirm",
        "policy": (
            "MCP Server 不提供 confirm/approve 工具。工具只能创建待确认事项；"
            "确认、拒绝与红色强验证必须由前端 Agent 平台的人审界面发起，"
            "防止 Agent 自建自批。"
        ),
        "tiers": {key: value for key, value in TIER_POLICY.items()},
    }


def tool_descriptors() -> list[dict]:
    return [capability.tool_descriptor() for capability in CAPABILITIES.values()]


def manifest() -> dict:
    kinds = {kind: sum(1 for c in CAPABILITIES.values() if c.kind == kind)
             for kind in ("query", "action", "plan")}
    return {
        "server": {
            "name": "finance-lab-mcp-capability-center",
            "title": "Finance Lab 银行 AI · MCP 能力中心",
            "version": "1.0.0",
            "protocol_version": PROTOCOL_LATEST,
            "transports": ["stdio", "http"],
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "instructions": SERVER_INSTRUCTIONS,
        "counts": {"total": len(CAPABILITIES), **kinds},
        "capabilities": tool_descriptors(),
        "resources": resource_descriptors(),
        "prompts": prompt_descriptors(),
        "confirmation": confirmation_policy(),
        "reverse_distillation": {
            "source_system": "Finance Lab 六场景银行 AI 智能体",
            "business_entry": "agent/banking/router.py#route",
            "method": [
                "盘点业务入口与页面流程",
                "抽取原子能力（动词+对象+槽位）",
                "契约化为 JSON Schema",
                "挂载权限/闸门/审计",
                "发布为 MCP tools/resources/prompts",
                "接入前端 Agent 平台的人审确认",
            ],
        },
    }


SERVER_INSTRUCTIONS = (
    "这是 Finance Lab 银行 AI 的 MCP 能力中心，暴露账户查询、账单分析、订阅/卡片读取，"
    "以及转账、订阅取消、卡片操作、跨场景计划的「发起请求」能力。"
    "所有资金/敏感动作只会生成待确认事项并返回 pending_ids，不会直接执行；"
    "确认与红色强验证必须由人类在前端 Agent 平台完成。调用前请先用 tools/list 或 "
    "banking_capability_catalog 确认权限级别，不要尝试绕过确认流程。"
)


# ============================================================
#  资源与提示词（能力中心的只读上下文入口）
# ============================================================


def resource_descriptors() -> list[dict]:
    return [
        {"uri": "banking://capabilities/catalog", "name": "能力目录",
         "description": "全部 MCP 能力、权限与来源映射", "mimeType": "application/json"},
        {"uri": "banking://account/overview", "name": "账户总览",
         "description": "余额、卡片、订阅与待确认数量", "mimeType": "application/json"},
        {"uri": "banking://bills/current", "name": "本月账单",
         "description": "本月消费聚合与异常", "mimeType": "application/json"},
        {"uri": "banking://subscriptions", "name": "订阅清单",
         "description": "识别出的订阅与续费提醒", "mimeType": "application/json"},
        {"uri": "banking://pending", "name": "待确认队列",
         "description": "当前待确认事项与定时任务", "mimeType": "application/json"},
    ]


def read_resource(uri: str) -> dict:
    handlers = {
        "banking://capabilities/catalog": lambda: capability_catalog({}),
        "banking://account/overview": lambda: account_overview({}),
        "banking://bills/current": lambda: bill_analyze({"period": "current_month"}),
        "banking://subscriptions": lambda: subscription_list({}),
        "banking://pending": lambda: pending_list({}),
    }
    handler = handlers.get(uri)
    if handler is None:
        raise CapabilityInputError(f"未知资源：{uri}")
    return handler()


def prompt_descriptors() -> list[dict]:
    return [
        {
            "name": "banking_transfer_guided",
            "title": "引导式转账",
            "description": "在发起转账前核对收款人、金额、权限与确认要求",
            "arguments": [
                {"name": "payee", "description": "收款人", "required": True},
                {"name": "amount", "description": "金额（元）", "required": True},
            ],
        },
        {
            "name": "banking_bill_review",
            "title": "账单复盘",
            "description": "按月份复盘消费结构、异常与大额商户",
            "arguments": [
                {"name": "period", "description": "YYYY-MM 或 current_month", "required": False},
            ],
        },
        {
            "name": "banking_subscription_audit",
            "title": "订阅体检",
            "description": "检查订阅、续费提醒并评估是否取消",
            "arguments": [],
        },
    ]


def get_prompt(name: str, arguments: dict | None = None) -> dict:
    arguments = arguments or {}
    if name == "banking_transfer_guided":
        payee = _text(arguments.get("payee"), "payee", max_length=40)
        amount = _text(arguments.get("amount"), "amount", max_length=20)
        text = (
            f"请帮我核对这笔转账：收款人 {payee}，金额 {amount} 元。\n"
            "先调用 banking_card_list / banking_account_overview 核对账户状态，"
            "再用 banking_transfer_prepare 发起请求。\n"
            "如果返回 pending_confirmation，请把 pending_id 展示给用户，"
            "由用户在前端确认；不要自行确认或声称已转账。"
        )
    elif name == "banking_bill_review":
        period = arguments.get("period") or "current_month"
        text = (
            f"请用 banking_bill_analyze 分析 {period} 账单，"
            "总结消费结构、异常交易与可执行的节省建议；引用数据时注明是演示数据。"
        )
    elif name == "banking_subscription_audit":
        text = (
            "请用 banking_subscription_list 读取订阅与续费提醒，"
            "按「即将扣费 / 可取消 / 保留」分类；取消前必须由用户确认。"
        )
    else:
        raise CapabilityInputError(f"未知提示词：{name}")
    return {
        "description": next(p["description"] for p in prompt_descriptors() if p["name"] == name),
        "messages": [{
            "role": "user",
            "content": {"type": "text", "text": text},
        }],
    }
