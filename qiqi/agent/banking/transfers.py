"""智能转账（场景 1）。

支持：
  · 按人名/手机号/备注转账（立即）
  · 定时转账（生成计划任务，到点执行前仍需按权限确认）
  · AA 拆分收款（生成多条待确认收款请求）

权限：日累计 ≤1000 元为黄色（确认），>1000 元为红色（多因子强验证）。
确定性闸门见 gates.check_transfer。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from contracts.banking import Contact, TransferRequest, TransferResult
from agent.banking.gates import check_transfer
from agent.banking.tiers import tier_of_operation


_AMOUNT_RE = re.compile(r"(\d+(?:\.\d{1,2})?)\s*(万|千|百)?\s*(?:元|块|块钱)?")
_PHONE_RE = re.compile(r"1[3-9]\d{9}")
_AA_RE = re.compile(r"[Aa][Aa]|分摊|平分|几个人分|大家平摊")


def parse_transfer_request(text: str, contacts: list[Contact]) -> TransferRequest:
    """从自然语言抽取转账请求。

    收款人优先级：手机号 > 通讯录姓名 > 「给X转」句式中的 X。
    """
    amount = 0.0
    m = _AMOUNT_RE.search(text)
    if m:
        amount = float(m.group(1))
        unit = m.group(2)
        amount *= {"万": 10000, "千": 1000, "百": 100}.get(unit or "", 1)

    memo = ""
    mm = re.search(r"备注[：:\s]*([^\s，。！？]+)", text)
    if mm:
        memo = mm.group(1)

    scheduled_at = ""
    sm = re.search(r"(明天|后天|下(?:周|月)[一二三四五六日天]?|(\d{1,2})[月\-](\d{1,2})[日号]?)\s*(?:上午|下午|晚上|早上|中午)?\s*(\d{1,2})?[：:]?(\d{2})?", text)
    if sm and ("定时" in text or "预约" in text or "到时" in text or re.search(r"(明天|后天)", text)):
        scheduled_at = sm.group(0)

    payee = ""
    for c in contacts:
        if c.phone and c.phone in text:
            payee = c.phone
            break
    if not payee:
        for c in contacts:
            if c.name and c.name in text:
                payee = c.name
                break
    if not payee:
        # 非贪婪 + 停词边界：避免「给小李转200」把「转」吃进名字里
        pm = re.search(
            r"(?:给|转给|转账给)\s*([\u4e00-\u9fa5A-Za-z·]{2,8}?)(?=转|汇款|备注|给|\d|[，。！？!?\s]|$)",
            text,
        )
        if pm:
            payee = pm.group(1)

    aa: list[str] = []
    if _AA_RE.search(text):
        n_match = re.search(r"(\d+)\s*(?:个?人|人分)", text)
        n = int(n_match.group(1)) if n_match else 3
        aa = [f"AA-{i+1}" for i in range(n)]

    now = datetime.now()
    return TransferRequest(
        request_id=f"tr_{now.strftime('%Y%m%d%H%M%S%f')}",
        payee=payee.strip(),
        amount=round(amount, 2),
        memo=memo,
        scheduled_at=scheduled_at,
        aa_participants=aa,
    )


def handle_transfer(
    text: str,
    contacts: list[Contact],
    balance: float,
    daily_cumulative: float,
    now: datetime | None = None,
) -> TransferResult:
    """处理转账意图：抽取 → 闸门 → 权限分级 → 结果。"""
    now = now or datetime.now()
    req = parse_transfer_request(text, contacts)

    if not req.payee and not req.aa_participants:
        return TransferResult(
            request=req, tier="blocked", status="blocked",
            message="信息不足：请说明收款人（通讯录姓名或手机号）与转账金额。",
            gate_checks=[],
        )
    if req.amount <= 0:
        return TransferResult(
            request=req, tier="blocked", status="blocked",
            message="信息不足：请说明转账金额。",
            gate_checks=[],
        )

    # AA 拆分不要求单一收款人——拆出多条待确认收款请求
    if req.aa_participants:
        share = round(req.amount / len(req.aa_participants), 2)
        items = [{
            "id": f"{req.request_id}_{i}",
            "label": f"收款请求 #{i+1}",
            "amount": share,
            "status": "pending_confirmation",
        } for i in range(len(req.aa_participants))]
        return TransferResult(
            request=req, tier="yellow", status="pending_confirmation",
            message=f"已生成 {len(items)} 条 AA 收款请求（每人 {share:,.2f} 元），等待逐个确认。",
            gate_checks=[], aa_items=items,
        )

    matched = next((c for c in contacts if req.payee in (c.name, c.phone)), None)
    passed, checks = check_transfer(req, contacts, balance, daily_cumulative)
    if not passed:
        reasons = "；".join(c["detail"] for c in checks if not c["passed"] and c["severity"] == "block")
        return TransferResult(
            request=req, tier="blocked", status="blocked",
            message=f"转账被确定性闸门拦截：{reasons}",
            gate_checks=checks, matched_contact=matched,
        )

    tier = tier_of_operation(
        "transfer",
        "transfer_schedule" if req.scheduled_at else "transfer_now",
        amount=req.amount, daily_cumulative=daily_cumulative,
    )

    if req.scheduled_at:
        return TransferResult(
            request=req, tier=tier, status="scheduled",
            message=f"已创建定时转账任务：{req.scheduled_at} 向 {req.payee} 转账 {req.amount:,.2f} 元"
                    f"{('，备注：' + req.memo) if req.memo else ''}。到点执行前仍需按当前权限确认。",
            gate_checks=checks, matched_contact=matched,
            daily_cumulative=daily_cumulative,
        )

    return TransferResult(
        request=req, tier=tier, status="pending_confirmation",
        message=f"转账请求已就绪：向 {matched.name if matched else req.payee} 转账 {req.amount:,.2f} 元"
                f"{('（备注：' + req.memo + '）') if req.memo else ''}，"
                f"权限级别：{'红色 · 需多因子强验证' if tier == 'red' else '黄色 · 需确认'}。",
        gate_checks=checks, matched_contact=matched,
        daily_cumulative=daily_cumulative,
    )


def split_aa(req: TransferRequest) -> list[dict]:
    """AA 拆分明细（把总金额摊到每个参与者）。"""
    if not req.aa_participants:
        return []
    share = round(req.amount / len(req.aa_participants), 2)
    return [{"id": f"{req.request_id}_{i}", "name": f"参与者 {i+1}", "amount": share}
            for i in range(len(req.aa_participants))]
