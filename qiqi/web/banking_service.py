"""六场景 Web 服务层——把 agent.banking.router 接到 HTTP。

职责（与 web/app.py 的分工）：
  · app.py：理财深度分析闭环 + HTTP 路由；
  · 本模块：五个新场景的 overview / run / confirm，以及黄色确认、
    红色强验证、熔断联动与审计留痕。确认动作复用与理财相同的人审
    原则（资金动作必须显式确认/强验证），但不进入理财的审批队列文件。
"""
from __future__ import annotations

import json
import hashlib
import logging
from copy import deepcopy
from functools import wraps
from uuid import uuid4
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from agent.banking import route as banking_route
from agent.banking import tier_label
from agent.banking.bill_import import parse_statement
from agent.banking.router import detect_scenario
from agent.banking.tiers import tier_of_operation
from agent.banking.cards import normalize_card_operation
from agent.banking.gates import check_transfer, check_card_operation, check_subscription_cancel
from contracts.banking import TransferRequest
from agent.risk.circuit_breaker import get_breaker
from agent.risk.audit import log_action
from web.banking_demo import (
    demo_bills, demo_cards, demo_contacts, demo_balance, get_banking_state,
)

logger = logging.getLogger("web.banking")

USER_ID = "demo_user"
PENDING_TTL_SECONDS = 10 * 60
SEED_PENDING_TTL_SECONDS = 2 * 60 * 60
DEMO_AS_OF = "2026-10-11"
DEMO_PROVENANCE = {
    "source": "demo_fixture",
    "verification_mode": "DEMO_MOCK",
    "identity_verified": False,
    "source_label": "演示固定数据",
    "simulation_notice": "演示模拟：不会发生真实资金转移、短信/人脸验证或外部下单。",
}

SCENARIOS_META = [
    {"key": "transfer", "name": "智能转账", "icon": "💸",
     "desc": "按人名/手机号转账、备注、定时转账、AA 收款",
     "examples": ["给王芳转500元备注聚餐", "给李明转5000", "聚餐300元AA，3个人"],
     "tier_note": "日累计≤1000 黄（确认）｜>1000 红（强验证）"},
    {"key": "bill", "name": "账单分析", "icon": "📊",
     "desc": "消费分类统计、异常交易识别、月度/年度账单报告",
     "examples": ["这个月账单分析", "帮我看看有没有异常交易", "2026年账单报告"],
     "tier_note": "绿（自动执行）"},
    {"key": "wealth", "name": "理财操作", "icon": "🏦",
     "desc": "组合诊断、产品推荐与对比、风险评估、申赎（深度路径）",
     "examples": ["平安银行卖出 30%", "是不是该跑了，帮我看看"],
     "tier_note": "绿/红（申赎强验证）"},
    {"key": "card", "name": "卡片管理", "icon": "💳",
     "desc": "卡查询、额度调整、交易限制、锁卡解锁、挂失",
     "examples": ["尾号8888的卡挂失", "尾号8888信用卡额度调到2万", "锁一下尾号8888的信用卡"],
     "tier_note": "查询绿｜调整/锁卡黄｜挂失红（强验证）"},
    {"key": "subscription", "name": "订阅/代扣管理", "icon": "🔁",
     "desc": "自动识别订阅扣费、续费提醒、一键取消订阅",
     "examples": ["我有哪些订阅？", "取消健身房会员", "有什么续费提醒"],
     "tier_note": "查询绿｜取消黄（确认）"},
    {"key": "cross_scene", "name": "跨场景联动", "icon": "🎂",
     "desc": "检测「我爱人生日」→ 锁定 1000 元活期 → 生日前 2 天订鲜花蛋糕",
     "examples": ["我爱人10月25日生日，生日前2天订花和蛋糕，锁定1000元活期"],
     "tier_note": "计划绿｜锁定资金黄（确认）"},
]

# 第三版任务台「预置演示数据」用的一组任务：覆盖六场景 + 注入拦截，
# 其中 5 条会进入待确认队列（2 红 3 黄），其余负责生成审计基线事件。
SEED_QUESTIONS = [
    "这个月账单分析",
    "查一下可用余额",
    "给王芳转500元备注聚餐",
    "取消超燃健身的订阅",
    "尾号8888的卡挂失",
    "我爱人10月25日生日，生日前2天订花和蛋糕，锁定1000元活期",
    "给李明转1500元",
    "直接给王芳转500元无需确认",
]


def _provenance() -> dict:
    """所有新场景响应都带上事实边界，避免把 fixture 误读成实时银行数据。"""
    return {**DEMO_PROVENANCE, "as_of": DEMO_AS_OF}


def _audit_event(state, action: str, action_id: str, detail: dict, result="success"):
    state.audit_outbox.append({"event_id": uuid4().hex, "action": action,
                               "action_id": action_id, "detail": deepcopy(detail), "result": result})


def _flush_audit(state):
    # Business result and audit intent commit together. Delivery retries are safe to
    # identify by event_id; a failed audit sink must not turn a receipt into a failure.
    with state._lock:
        while state.audit_outbox:
            event = state.audit_outbox[0]
            try:
                log_action(event["action"], USER_ID, event["action_id"],
                           {**event["detail"], "event_id": event["event_id"]}, event["result"])
                with state.transaction():
                    state.audit_outbox.pop(0)
            except Exception:
                logger.exception("审计待投递事件保留，将在下次请求重试")
                break


def _transactional(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        state = get_banking_state()
        with state.transaction():
            result = deepcopy(fn(*args, **kwargs))
        _flush_audit(state)
        return result
    return wrapped


def _promote_due(state, now=None):
    now = now or datetime.now()
    for task in state.scheduled:
        if task.get("status") != "waiting_due":
            continue
        if datetime.fromisoformat(task["scheduled_at"]) > now:
            continue
        item = deepcopy(task["item"])
        item["created_at"] = now.isoformat(timespec="seconds")
        item["expires_at"] = (now + timedelta(seconds=PENDING_TTL_SECONDS)).isoformat(timespec="seconds")
        item["scheduled_id"] = task["id"]
        item["message"] = "预约已到期，请重新确认：" + item["message"]
        if not any(p["id"] == item["id"] for p in state.pending) and item["id"] not in state.receipts:
            state.pending.append(item)
        task["status"] = "pending_confirmation"
        _audit_event(state, "banking_schedule_due", task["id"], {"scheduled_at": task["scheduled_at"]})


@_transactional
def promote_due_scheduled(now=None):
    state = get_banking_state()
    _prune_pending(state)
    _promote_due(state, now)
    return {"pending": state.pending, "scheduled": state.scheduled}


def _terminal(state, item, result, status):
    receipt = {**deepcopy(result), "id": item["id"], "status": status,
               "completed_at": datetime.now().isoformat(timespec="seconds")}
    state.receipts[item["id"]] = receipt
    state.pending = [p for p in state.pending if p["id"] != item["id"]]
    for task in state.scheduled:
        if task["id"] == item["id"]:
            task["status"] = status
    return receipt


def _pending_key(scenario: str, question: str, payload: dict) -> str:
    """同一会话中相同待确认请求只保留一条。计划 ID 等动态字段不参与去重。"""
    def stable(value):
        if isinstance(value, dict):
            return {
                key: stable(val) for key, val in value.items()
                if key not in {"plan_id", "request_id", "id"}
            }
        if isinstance(value, list):
            return [stable(item) for item in value]
        return value

    stable_payload = stable(payload or {})
    raw = json.dumps({
        "scenario": scenario,
        "question": " ".join((question or "").lower().split()),
        "payload": stable_payload,
    }, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _prune_pending(state) -> bool:
    """清除过期待确认项，并为旧状态补上失效时间。"""
    now = datetime.now()
    changed = False
    kept = []
    for item in state.pending:
        expires_at = item.get("expires_at")
        if not expires_at:
            try:
                created = datetime.fromisoformat(str(item.get("created_at", "")))
            except ValueError:
                created = now
            expires_at = (created + timedelta(seconds=PENDING_TTL_SECONDS)).isoformat(timespec="seconds")
            item["expires_at"] = expires_at
            changed = True
        try:
            expired = datetime.fromisoformat(str(expires_at)) <= now
        except ValueError:
            expired = True
        if expired:
            _terminal(state, item, {"success": False, "message": "待确认事项已过期"}, "expired")
            _audit_event(state, "banking_pending_expired", str(item.get("id", "")), {
                "scenario": item.get("scenario"), "request_key": item.get("request_key"),
            }, "failure")
            changed = True
            continue
        kept.append(item)
    if len(kept) != len(state.pending):
        state.pending = kept
        changed = True
    if changed:
        state.save()
    return changed


@_transactional
def scenario_overview() -> dict:
    state = get_banking_state()
    _prune_pending(state)
    _promote_due(state)
    bills = demo_bills()
    subs = state.subscriptions(bills)
    return {
        "scenarios": SCENARIOS_META,
        "cards": [{
            "card_id": c.card_id, "last4": c.last4, "bank": c.bank,
            "card_type": c.card_type, "status": c.status,
            "credit_limit": c.credit_limit, "daily_txn_limit": c.daily_txn_limit,
        } for c in state.cards],
        "subscriptions": [{
            "sub_id": s.sub_id, "merchant": s.merchant, "amount": s.amount,
            "cadence": s.cadence, "next_charge_at": s.next_charge_at,
            "status": s.status, "due_soon": s.due_soon(),
        } for s in subs],
        "contacts": [{"name": c.name, "phone": c.phone, "relation": c.relation}
                     for c in demo_contacts()],
        "balance": state.balance,
        "daily_cumulative": state.daily_cumulative,
        "pending": state.pending,
        "scheduled": state.scheduled,
        "collections": state.collections,
        "tier_matrix": [
            {"tier": "green", "label": "绿色权限",
             "items": "余额/交易记录查询、账单分析、订阅与续费查询、卡片状态查询、理财收益查询",
             "policy": "确认意图后自动执行，无需二次确认"},
            {"tier": "yellow", "label": "黄色权限",
             "items": "小额转账（日累计≤1000元）、订阅取消、额度/限额调整、锁卡解锁",
             "policy": "执行前展示操作详情并获得明确确认"},
            {"tier": "red", "label": "红色权限",
             "items": "大额转账（日累计>1000元）、卡片挂失/解挂、理财产品申赎",
             "policy": "须通过人脸识别、短信验证码或 U 盾等多因子认证"},
        ],
        "breaker": get_breaker().state(),
        "demo_seeded": state.demo_seeded,
        "provenance": _provenance(),
        "experience_boundary": "简单查询直接返回；只有含糊、多步骤或有风险的请求才进入计划与确认链。",
    }


def _run_and_queue(state, question: str, *, seeded: bool = False, bills_data=None):
    """跑一次确定性场景，并把黄/红操作挂到运行态待确认队列。

    返回 (ScenarioResult, deduplicated)。seeded=True 表示来自「预置演示
    数据」：待确认项打 seeded 标记、有效期延长到 2 小时，避免演示期间
    因 10 分钟 TTL 过期被清走。
    """
    res = banking_route(
        question, bills_data=bills_data if bills_data is not None else demo_bills(), cards_data=state.cards,
        contacts=demo_contacts(), balance=getattr(state, "spendable_balance", state.balance),
        daily_cumulative=state.daily_cumulative, user_id=USER_ID,
        cancelled_subs=state.cancelled_subs,
    )
    if hasattr(state, "spendable_balance") and state.spendable_balance != state.balance:
        res.message = res.message.replace("账户余额", "扣除已确认保留后的可安排现金")
        for check in res.data.get("gate_checks", []):
            check["detail"] = check.get("detail", "").replace("账户余额", "扣除已确认保留后的可安排现金")
        res.data["account_cash"] = state.balance
        res.data["spendable_cash"] = state.spendable_balance
    deduplicated = False
    if res.status not in ("pending_confirmation", "scheduled"):
        return res, deduplicated
    candidates = []
    if res.data.get("aa_items"):
        for share in res.data["aa_items"]:
            data = {"request": {"operation": "aa_collect", "amount": share["amount"],
                                "payee": share["name"], "memo": res.data["request"]["memo"]}}
            candidates.append((data, f"AA 模拟收款：向{share['name']}发起 {share['amount']:.2f} 元收款请求（不会转出资金）。"))
    else:
        candidates.append((res.data, res.message))
    active = state.pending + [t["item"] for t in state.scheduled if t["status"] == "waiting_due"]
    new_items = []
    for data, message in candidates:
        key = _pending_key(res.scenario, question, data)
        if any(p.get("request_key") == key for p in active):
            deduplicated = True
            continue
        created = datetime.now()
        ttl = SEED_PENDING_TTL_SECONDS if seeded else PENDING_TTL_SECONDS
        item = {"id": "p_" + uuid4().hex, "scenario": res.scenario, "tier": res.tier,
                "created_at": created.isoformat(timespec="seconds"),
                "expires_at": (created + timedelta(seconds=ttl)).isoformat(timespec="seconds"),
                "request_key": key, "message": message, "payload": deepcopy(data),
                "plan": deepcopy(res.plan)}
        if seeded:
            item["seeded"] = True
        new_items.append(item)
    if len(active) + len(new_items) > 200:
        res.status, res.message = "blocked", "待办已达上限，请先处理或取消已有待办。"
        return res, False
    for item in new_items:
        if res.status == "scheduled":
            state.scheduled.append({"id": item["id"], "scheduled_at": res.data["request"]["scheduled_at"],
                                    "status": "waiting_due", "item": item})
            _audit_event(state, "banking_schedule_created", item["id"], item["payload"])
        else:
            state.pending.append(item)
    return res, deduplicated


@_transactional
def run_scenario(text: str, bill_file: dict | None = None) -> dict:
    question = (text or "").strip()
    if not question:
        return {"delegated": False, "result": None, "message": "请输入自然语言请求"}
    state = get_banking_state()
    _prune_pending(state)
    _promote_due(state)
    source_record = None
    imported = None
    if bill_file is not None:
        if detect_scenario(question) != "bill" or not isinstance(bill_file, dict):
            raise ValueError("上传账单只能绑定账单分析任务")
        imported, source_record = parse_statement(bill_file.get("name"), bill_file.get("text"))
    res, deduplicated = _run_and_queue(state, question, bills_data=imported)
    if res.status == "delegated":
        return {"delegated": True, "result": None, "message": res.message}
    trace_id = "bill_" + uuid4().hex if source_record else None
    provenance = _provenance()
    if res.intent.get("name") == "fund_knowledge":
        provenance = {"source": "curated_definition", "source_label": "程序内置的基金定义",
                      "simulation_notice": "仅作知识解释；未调用账户工具、未提出或执行买卖动作。"}
    if source_record and res.scenario == "bill" and res.status == "done":
        res.data["source_record"] = source_record
        res.data["trace_id"] = trace_id
        provenance = {**provenance, "source": "uploaded_file", "source_label": "本次上传的文件",
                      "batch_id": source_record["batch_id"]}
        _audit_event(state, "banking_bill_import_analyzed", trace_id, {
            "batch_id": source_record["batch_id"], "period": res.data["period"],
            "row_count": source_record["row_count"], "total_spend": res.data["total_spend"]})
    return {"delegated": False, "result": {
        "scenario": res.scenario, "scenario_label": res.scenario_label,
        "intent": res.intent, "plan": res.plan, "tier": res.tier,
        "tier_label": tier_label(res.tier), "status": res.status,
        "message": res.message, "data": res.data, "provenance": provenance,
    }, "pending": state.pending, "scheduled": state.scheduled,
        "breaker": get_breaker().state(), "provenance": provenance, "deduplicated": deduplicated}


@_transactional

def seed_demo_queue() -> dict:
    """预置演示数据：跑一组覆盖六场景 + 注入拦截的任务。

    待确认队列为空时执行（幂等）；产生的待确认项与审计事件都是真实
    走规则引擎、真实落盘的服务端记录，仅多带 seeded 标记供界面标注。
    队列已有内容时不动，避免覆盖用户现场。
    """
    state = get_banking_state()
    _prune_pending(state)
    if state.pending:
        return {"seeded": False, "pending": list(state.pending),
                "message": "待确认队列已有内容，未重复预置。", "provenance": _provenance()}
    for question in SEED_QUESTIONS:
        try:
            _run_and_queue(state, question, seeded=True)
        except Exception:      # noqa: BLE001
            logger.exception("预置演示任务失败：%s", question)
    created = sum(1 for p in state.pending if p.get("seeded"))
    state.demo_seeded = True
    state.save()
    log_action("banking_demo_seeded", USER_ID, "", {
        "questions": len(SEED_QUESTIONS), "pending_created": created,
        "note": "演示预置：队列与审计事件均为真实规则引擎产物，仅加 seeded 标记",
    }, "success")
    return {"seeded": True, "pending": list(state.pending),
            "message": f"已预置 {created} 条待确认演示项与审计基线，点击任意项继续下一步。",
            "provenance": _provenance()}


@_transactional
def confirm_action(payload: dict) -> dict:
    state = get_banking_state()
    _prune_pending(state)
    _promote_due(state)
    pending_id = str(payload.get("id", "")).strip()

    def response(ok, message, **extra):
        return {"success": ok, "message": message, "pending": state.pending,
                "scheduled": state.scheduled, "breaker": get_breaker().state(),
                "provenance": _provenance(), **extra}

    item = next((p for p in state.pending if p.get("id") == pending_id), None)
    if item is None:
        return response(False, "待确认事项不存在、已处理或已过期", receipt=state.receipts.get(pending_id))
    if get_breaker().is_locked():
        return response(False, "系统熔断锁定中，请先人工确认恢复。")

    scenario, data = item["scenario"], item.get("payload") or {}
    tier, checks, passed = item["tier"], [], True
    request = data.get("request") or {}
    operation = request.get("operation", "transfer")
    if scenario == "transfer" and operation == "transfer":
        req = TransferRequest(request_id=pending_id, payee=request.get("payee", ""),
                              amount=float(request.get("amount", 0)))
        passed, checks = check_transfer(req, demo_contacts(), getattr(state, "spendable_balance", state.balance), state.daily_cumulative)
        if hasattr(state, "spendable_balance") and state.spendable_balance != state.balance:
            for check in checks:
                check["detail"] = check.get("detail", "").replace("账户余额", "扣除已确认保留后的可安排现金")
        tier = tier_of_operation("transfer", "transfer_now", req.amount, state.daily_cumulative)
    elif scenario == "transfer" and operation == "aa_collect":
        passed = bool(request.get("payee")) and float(request.get("amount", 0)) > 0
        tier = "yellow"
    elif scenario == "card":
        card = next((c for c in state.cards if c.card_id == data.get("card", {}).get("card_id")
                     or c.last4 == data.get("card", {}).get("last4")), None)
        op = normalize_card_operation(card, data.get("operation", "")) if card else data.get("operation", "")
        data["operation"] = op
        passed, checks = check_card_operation(card, op, data.get("new_limit"))
        tier = tier_of_operation("card", op)
    elif scenario == "subscription":
        target = data.get("target") or {}
        sub = next((s for s in state.subscriptions(demo_bills()) if
                    s.sub_id == target.get("sub_id", f"sub_{target.get('merchant', '')}_{target.get('amount', 0):.0f}")), None)
        passed, checks = check_subscription_cancel(sub)
    elif scenario != "cross_scene":
        passed = False
    if not passed:
        message = "执行前复核未通过：" + ("；".join(c["detail"] for c in checks if not c["passed"])
                                     or "请求无效，请重新发起")
        _terminal(state, item, {"success": False, "message": message}, "blocked")
        _audit_event(state, "banking_confirmation_blocked", pending_id, {"checks": checks}, "failure")
        return response(False, message, gate_checks=checks)
    if tier == "red" and item["tier"] != "red":
        item["tier"] = tier
        item["message"] += " 当前状态已变化，升级为红色权限，须重新强验证确认。"
        return response(False, "当前累计金额或卡片状态已变化，请核对并重新强验证确认。", tier=tier, tier_changed=True)
    item["tier"] = tier
    if tier == "red":
        verification = payload.get("verification") or {}
        sms = str(verification.get("sms_code", "")).strip()
        face = verification.get("face_verified") is True
        verified = len(sms) == 6 and sms.isascii() and sms.isdigit() and face
        _audit_event(state, "banking_strong_verification", pending_id,
                     {"sms_code_ok": len(sms) == 6 and sms.isascii() and sms.isdigit(), "face_ok": face,
                      "channel": "Mock 演示验证"}, "success" if verified else "failure")
        if not verified:
            get_breaker().record_failure("strong_verify_failed", {"pending_id": pending_id}, USER_ID)
            return response(False, "强验证未通过：需要6位短信验证码并完成人脸识别（演示为 Mock）。", tier=tier)

    result = {"success": True, "tier": tier, "scenario": scenario}
    if scenario == "transfer":
        amount, payee = float(request["amount"]), request["payee"]
        if operation == "aa_collect":
            collection = {"id": pending_id, "participant": payee, "amount": amount,
                          "status": "issued", "simulation": True}
            state.collections.append(collection)
            result.update(message=f"已创建向{payee}收取 {amount:.2f} 元的模拟收款请求；尚未收款。", collection=collection)
        else:
            state.record_transfer(amount)
            result.update(message=f"转账成功（演示模拟）：向 {payee} 转出 {amount:,.2f} 元。",
                          daily_cumulative=state.daily_cumulative, balance=state.balance)
    elif scenario == "subscription":
        state.mark_subscription_cancelled(sub.sub_id)
        result["message"] = f"已取消订阅：{sub.merchant}（演示模拟）。"
    elif scenario == "card":
        state.apply_card_action(card.card_id, op, data.get("new_limit"))
        label = {"lock": "锁卡", "unlock": "解锁", "loss_report": "挂失", "loss_release": "解挂", "limit_adjust": "额度调整"}.get(op, op)
        result["message"] = f"卡片操作已生效（演示模拟）：{label}。"
    else:
        result.update(message="跨场景计划已确认（演示模拟）：资金锁定与外部订购均未调用真实服务。",
                      plan_id=(data.get("plan") or {}).get("plan_id", ""))
    receipt = _terminal(state, item, result, "executed")
    _audit_event(state, "banking_action_executed", pending_id,
                 {"scenario": scenario, "operation": operation if scenario == "transfer" else data.get("operation"),
                  "receipt": receipt, "simulation": True})
    return response(True, result.pop("message"), **{k: v for k, v in result.items() if k != "success"}, receipt=receipt)


@_transactional
def pending_list() -> list[dict]:
    state = get_banking_state()
    _prune_pending(state)
    _promote_due(state)
    return state.pending


@_transactional
def cancel_pending(pending_id: str) -> dict:
    state = get_banking_state()
    _prune_pending(state)
    item = next((p for p in state.pending if p["id"] == pending_id), None)
    if item is None:
        task = next((t for t in state.scheduled if t["id"] == pending_id and t["status"] == "waiting_due"), None)
        item = task["item"] if task else None
    if item is None:
        return {"success": False, "message": "待确认事项不存在、已处理或已过期",
                "pending": state.pending, "scheduled": state.scheduled, "provenance": _provenance()}
    _terminal(state, item, {"success": True, "message": "用户已拒绝该操作"}, "rejected")
    _audit_event(state, "banking_pending_rejected", pending_id, {"scenario": item["scenario"]})
    return {"success": True, "pending": state.pending, "scheduled": state.scheduled,
            "message": "已拒绝该操作（演示）。", "provenance": _provenance()}
