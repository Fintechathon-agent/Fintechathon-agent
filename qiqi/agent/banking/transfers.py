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
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta

from contracts.banking import Contact, TransferRequest, TransferResult
from agent.banking.gates import check_transfer
from agent.banking.tiers import tier_of_operation


_PHONE_RE = re.compile(r"1[3-9]\d{9}")
_AA_RE = re.compile(r"[Aa][Aa]|分摊|平分|几个人分|大家平摊")


def parse_schedule(text: str, now: datetime) -> str:
    """Resolve supported dates; unspecified time is explicitly 09:00 local time."""
    wants_schedule = re.search(r"定时|预约|明天|后天|下周|下个?月|今天|今晚|小时后|分钟后|上午|下午|晚上|早上|中午|凌晨|\d{1,2}点|\d{1,2}[:：]\d{2}|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{2}-\d{2}", text)
    if not wants_schedule:
        return ""
    target = now
    if "后天" in text:
        target += timedelta(days=2)
    elif "明天" in text:
        target += timedelta(days=1)
    elif re.search(r"下周[一二三四五六日天]", text):
        day = re.search(r"下周([一二三四五六日天])", text).group(1)
        target += timedelta(days=7 - now.weekday() + min("一二三四五六日天".index(day), 6))
    else:
        date = re.search(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]", text)
        iso_date = re.search(r"\d{4}-\d{2}-\d{2}", text)
        if date:
            target = target.replace(year=int(date.group(1) or now.year), month=int(date.group(2)), day=int(date.group(3)))
        elif iso_date:
            target = datetime.fromisoformat(iso_date.group())
        elif "今天" not in text:
            raise ValueError("请给出明确预约日期，例如明天上午10点")
    clock = re.search(r"(?:(上午|下午|晚上|早上|中午)\s*)?(\d{1,2})(?:点|:|：)(?:(\d{1,2})分?)?", text)
    hour, minute = (9, 0)
    if clock:
        hour, minute = int(clock.group(2)), int(clock.group(3) or 0)
        if "点半" in text:
            minute = 30
        if clock.group(1) in ("下午", "晚上", "中午") and hour < 12:
            hour += 12
    target = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        raise ValueError("预约时间已经过去，请指定未来的日期和时间")
    return target.isoformat(timespec="seconds")


def parse_transfer_request(text: str, contacts: list[Contact], now: datetime | None = None) -> TransferRequest:
    """从自然语言抽取转账请求。

    收款人优先级：手机号 > 通讯录姓名 > 「给X转」句式中的 X。
    """
    now = now or datetime.now()
    amount = 0.0
    error = ""
    amount_text = _PHONE_RE.sub(" ", text.split("备注")[0])
    candidates = re.findall(r"([+-]?\d+(?:\.\d+)?)\s*(万|千|百)?\s*(?:元|块钱|块)", amount_text)
    if not candidates:
        candidates = re.findall(r"(?:转账|转|汇款|打款)\s*([+-]?\d+(?:\.\d+)?)\s*(万|千|百)?", amount_text)
    if len(candidates) == 1:
        number, unit = candidates[0]
        try:
            value = Decimal(number) * {"万": 10000, "千": 1000, "百": 100}.get(unit, 1)
            if value != value.quantize(Decimal("0.01")):
                error = "金额精度须到分，请重新说明金额"
            elif value > Decimal("1000000000000"):
                error = "金额超出可办理范围，请重新说明金额"
            else:
                amount = float(value)
        except InvalidOperation:
            error = "金额无效，请重新说明金额"
    elif len(candidates) > 1:
        error = "检测到多笔金额，请分别发起转账以逐笔确认"

    memo = ""
    mm = re.search(r"备注[：:\s]*([^\s，。！？]+)", text)
    if mm:
        memo = mm.group(1)

    scheduled_at = ""
    try:
        scheduled_at = parse_schedule(text.split("备注")[0], now)
    except ValueError as exc:
        error = str(exc)

    payee_text = text.split("备注")[0]
    phones = _PHONE_RE.findall(payee_text)
    payee = phones[0] if phones else ""
    matched_contacts = [c for c in contacts if (c.name and c.name in payee_text) or (c.phone and c.phone in payee_text)]
    if len(set(phones)) > 1 or len(matched_contacts) > 1:
        error = "检测到多个收款人，请分别发起转账以逐笔确认"
    if not payee:
        for c in contacts:
            if c.name and c.name in payee_text:
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
        n = int(n_match.group(1)) if n_match else 0
        if not 2 <= n <= 100:
            error = "请说明AA参与人数（2至100人）"
        else:
            aa = [f"AA-{i+1}" for i in range(n)]

    return TransferRequest(
        request_id=f"tr_{now.strftime('%Y%m%d%H%M%S%f')}",
        payee=payee.strip(),
        amount=round(amount, 2),
        memo=memo,
        scheduled_at=scheduled_at,
        aa_participants=aa,
        validation_error=error,
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
    req = parse_transfer_request(text, contacts, now)
    if req.validation_error:
        return TransferResult(request=req, tier="green", status="needs_clarification", message=req.validation_error)

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
        if req.scheduled_at or req.amount * 100 < len(req.aa_participants):
            return TransferResult(request=req, tier="green", status="needs_clarification",
                                  message="AA 收款暂不支持预约，且每人份额至少为一分钱，请调整请求")
        items = [{**item, "label": f"收款请求 #{i+1}", "status": "pending_confirmation"}
                 for i, item in enumerate(split_aa(req))]
        return TransferResult(
            request=req, tier="yellow", status="pending_confirmation",
            message=f"已生成 {len(items)} 条 AA 收款请求，共 {req.amount:,.2f} 元，逐个确认后创建模拟收款请求，不转出资金。",
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
            message=f"定时转账安排：{req.scheduled_at} 向 {req.payee} 转账 {req.amount:,.2f} 元"
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
    cents, remainder = divmod(int(Decimal(str(req.amount)) * 100), len(req.aa_participants))
    return [{"id": f"{req.request_id}_{i}", "name": f"参与者 {i+1}", "amount": (cents + (i < remainder)) / 100}
            for i in range(len(req.aa_participants))]
