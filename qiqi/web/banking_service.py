"""六场景 Web 服务层——把 agent.banking.router 接到 HTTP。

职责（与 web/app.py 的分工）：
  · app.py：理财旗舰闭环 + HTTP 路由；
  · 本模块：五个新场景的 overview / run / confirm，以及黄色确认、
    红色强验证、熔断联动与审计留痕。确认动作复用与理财相同的人审
    原则（资金动作必须显式确认/强验证），但不进入理财的审批队列文件。
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from agent.banking import route as banking_route
from agent.banking import detect_scenario, tier_label
from agent.risk.circuit_breaker import get_breaker
from agent.risk.audit import log_action
from web.banking_demo import (
    demo_bills, demo_cards, demo_contacts, demo_balance, get_banking_state,
)

logger = logging.getLogger("web.banking")

USER_ID = "demo_user"

SCENARIOS_META = [
    {"key": "transfer", "name": "智能转账", "icon": "💸",
     "desc": "按人名/手机号转账、备注、定时转账、AA 收款",
     "examples": ["给陈大黄转500元备注聚餐", "给林粹转5000", "聚餐300元AA，3个人"],
     "tier_note": "日累计≤1000 黄（确认）｜>1000 红（强验证）"},
    {"key": "bill", "name": "账单分析", "icon": "📊",
     "desc": "消费分类统计、异常交易识别、月度/年度账单报告",
     "examples": ["这个月账单分析", "帮我看看有没有异常交易", "2026年账单报告"],
     "tier_note": "绿（自动执行）"},
    {"key": "wealth", "name": "理财操作", "icon": "🏦",
     "desc": "组合体检、产品推荐与对比、风险评估、申赎（深度旗舰）",
     "examples": ["平安银行卖出 30%", "是不是该跑了，帮我看看"],
     "tier_note": "绿/红（申赎强验证）"},
    {"key": "card", "name": "卡片管理", "icon": "💳",
     "desc": "卡查询、额度调整、交易限制、锁卡解锁、挂失",
     "examples": ["尾号8888的卡挂失", "信用卡额度调到2万", "锁一下我的信用卡"],
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


def scenario_overview() -> dict:
    state = get_banking_state()
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
        "balance": demo_balance(),
        "daily_cumulative": state.daily_cumulative,
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
    }


def run_scenario(text: str) -> dict:
    """统一场景执行入口：理财请求标记 delegated，其余直接执行。"""
    question = (text or "").strip()
    if not question:
        return {"delegated": False, "result": None, "message": "请输入自然语言请求"}
    scenario = detect_scenario(question)
    if scenario == "wealth":
        return {"delegated": True, "result": None,
                "message": "理财请求转交旗舰闭环"}

    state = get_banking_state()
    res = banking_route(
        question,
        bills_data=demo_bills(),
        cards_data=state.cards,
        contacts=demo_contacts(),
        balance=demo_balance(),
        daily_cumulative=state.daily_cumulative,
        user_id=USER_ID,
    )
    # 挂到运行态待确认队列（黄/红操作）
    if res.status == "pending_confirmation" and res.scenario in ("transfer", "subscription", "card"):
        state.pending.append({
            "id": f"p_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "scenario": res.scenario,
            "tier": res.tier,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "message": res.message,
            "payload": res.data,
        })
        state.pending = state.pending[-20:]
        state.save()

    return {"delegated": False, "result": {
        "scenario": res.scenario,
        "scenario_label": res.scenario_label,
        "intent": res.intent,
        "plan": res.plan,
        "tier": res.tier,
        "tier_label": tier_label(res.tier),
        "status": res.status,
        "message": res.message,
        "data": res.data,
    }, "pending": state.pending, "breaker": get_breaker().state()}


def confirm_action(payload: dict) -> dict:
    """确认黄色/红色待办：黄=明确确认；红=短信+人脸 Mock 强验证。

    强验证失败计入熔断（连续 3 次安全事件锁定，与理财路径同一熔断器）。
    """
    pending_id = str(payload.get("id", "")).strip()
    state = get_banking_state()
    if not pending_id:
        return {"success": False, "message": "缺少待确认事项 ID"}

    item = next((p for p in state.pending if p.get("id") == pending_id), None)
    if item is None:
        return {"success": False, "message": "待确认事项不存在或已处理"}

    if get_breaker().is_locked():
        return {"success": False,
                "message": "⛔ 系统熔断锁定中：连续安全事件超过阈值，已暂停执行链路，请先人工确认恢复。"}

    tier = item.get("tier", "yellow")
    # 红色：多因子强验证（短信 6 位 + 人脸，演示 Mock）
    if tier == "red":
        sms = str(payload.get("verification", {}).get("sms_code", "")).strip()
        face = bool(payload.get("verification", {}).get("face_verified"))
        passed = len(sms) == 6 and sms.isdigit() and face
        log_action("banking_strong_verification", USER_ID, pending_id, {
            "method": "短信验证码 + 人脸识别",
            "channel": "Mock（演示环境不发送真实短信）",
            "sms_code_ok": len(sms) == 6 and sms.isdigit(), "face_ok": face,
        }, "success" if passed else "failure")
        if not passed:
            get_breaker().record_failure("strong_verify_failed", {
                "pending_id": pending_id, "scenario": item.get("scenario"),
            }, USER_ID)
            return {"success": False, "tier": tier,
                    "breaker": get_breaker().state(),
                    "message": "强验证未通过：需要 6 位短信验证码并完成人脸识别（演示为 Mock）。"}

    scenario = item.get("scenario", "")
    data = item.get("payload", {}) or {}
    result: dict = {"success": True, "tier": tier, "scenario": scenario}

    try:
        if scenario == "transfer":
            amount = float((data.get("request") or {}).get("amount", 0))
            payee = (data.get("request") or {}).get("payee", "")
            memo = (data.get("request") or {}).get("memo", "")
            state.record_transfer(amount)
            result.update({
                "message": f"转账成功（演示模拟）：向 {payee} 转出 {amount:,.2f} 元"
                           f"{('，备注：' + memo) if memo else ''}。",
                "daily_cumulative": state.daily_cumulative,
            })
            log_action("banking_transfer_executed", USER_ID, pending_id, {
                "payee": payee, "amount": amount, "memo": memo, "tier": tier,
                "note": "演示模拟，未发生真实资金转移",
            }, "success")
        elif scenario == "subscription":
            target = data.get("target") or {}
            merchant = target.get("merchant", "")
            state.mark_subscription_cancelled(f"sub_{merchant}_{target.get('amount', 0):.0f}")
            result["message"] = f"已取消订阅：{merchant}。历史账单保留，仅停止后续自动扣费（演示模拟）。"
            log_action("banking_subscription_cancelled", USER_ID, pending_id, {
                "merchant": merchant, "tier": tier,
            }, "success")
        elif scenario == "card":
            card = data.get("card") or {}
            op = data.get("operation", "")
            # 额度调整需要从原话里带出新额度——payload 里已保存 gate_checks，
            # 这里按操作名映射状态变更
            state.apply_card_action(card.get("card_id", "") or
                                    _card_id_by_last4(state, card.get("last4", "")), op)
            op_label = {"lock": "锁卡", "unlock": "解锁", "loss_report": "挂失",
                        "limit_adjust": "额度调整"}.get(op, op)
            result["message"] = f"卡片操作已生效（演示模拟）：{op_label}。"
            log_action("banking_card_action_executed", USER_ID, pending_id, {
                "operation": op, "tier": tier,
            }, "success")
        else:
            result["message"] = "已确认。"
    except Exception as exc:      # noqa: BLE001
        logger.exception("确认动作执行失败：%s", exc)
        return {"success": False, "message": f"执行失败：{exc}"}

    state.pending = [p for p in state.pending if p.get("id") != pending_id]
    state.save()
    result["pending"] = state.pending
    result["breaker"] = get_breaker().state()
    return result


def _card_id_by_last4(state, last4: str) -> str:
    for c in state.cards:
        if c.last4 == last4:
            return c.card_id
    return ""


def pending_list() -> list[dict]:
    return list(get_banking_state().pending)


def cancel_pending(pending_id: str) -> dict:
    """用户拒绝黄色/红色待办。"""
    state = get_banking_state()
    item = next((p for p in state.pending if p.get("id") == pending_id), None)
    if item is None:
        return {"success": False, "message": "待确认事项不存在或已处理"}
    state.pending = [p for p in state.pending if p.get("id") != pending_id]
    state.save()
    log_action("banking_pending_rejected", USER_ID, pending_id, {
        "scenario": item.get("scenario"), "tier": item.get("tier"),
    }, "success")
    return {"success": True, "pending": state.pending,
            "message": "已拒绝该操作（演示）。"}
