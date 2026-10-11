"""卡片管理（场景 4）。

操作与权限：查询=绿；锁卡/解锁/额度调整=黄（确认）；挂失=红（多因子强验证）。
确定性闸门见 gates.check_card_operation；挂失走强验证后立即锁卡。
"""
from __future__ import annotations

import re
from datetime import datetime

from contracts.banking import BankCard, CardActionResult
from agent.banking.gates import check_card_operation
from agent.banking.tiers import tier_of_operation


def find_card(cards: list[BankCard], text: str) -> BankCard | None:
    """按尾号（如 8888/尾号8888）或银行名匹配卡片。"""
    m = re.search(r"(?:尾号|卡号)?\s*(\d{4})", text)
    if m:
        for c in cards:
            if c.last4 == m.group(1):
                return c
    for c in cards:
        if c.bank in text:
            return c
    return None


def parse_card_operation(text: str) -> tuple[str, float | None]:
    """识别卡片操作与额度参数。"""
    if re.search(r"挂失", text):
        op = "loss_report"
    elif re.search(r"解锁|解挂|恢复使用", text):
        op = "unlock"
    elif re.search(r"锁定|锁卡|冻结|暂时停用|锁一下|锁", text):
        op = "lock"
    elif re.search(r"额度|限额", text):
        op = "limit_adjust"
    else:
        op = "query"

    new_limit: float | None = None
    if op == "limit_adjust":
        m = re.search(r"(\d+(?:\.\d+)?)\s*(万|千|百)?\s*(?:元)?", text)
        if m:
            new_limit = float(m.group(1))
            unit = m.group(2)
            new_limit *= {"万": 10000, "千": 1000, "百": 100}.get(unit or "", 1)
    return op, new_limit


def handle_card_action(
    text: str,
    cards: list[BankCard],
) -> CardActionResult:
    """处理卡片操作意图。查询为绿色自动执行；其余进入待确认（黄/红）。"""
    card = find_card(cards, text)
    op, new_limit = parse_card_operation(text)
    passed, checks = check_card_operation(card, op, new_limit)
    if not passed:
        reasons = "；".join(c["detail"] for c in checks if not c["passed"] and c["severity"] == "block")
        return CardActionResult(
            card_id=card.card_id if card else "", operation=op, tier="blocked",
            status="blocked", message=f"卡片操作被确定性闸门拦截：{reasons}",
            gate_checks=checks,
        )

    tier = tier_of_operation("card", op)
    if op == "query":
        return CardActionResult(
            card_id=card.card_id, operation=op, tier="green", status="executed",
            message=f"尾号 {card.last4}（{card.bank} {card.card_type}）状态：{card.status}，"
                    f"{'额度 ' + format(card.credit_limit, ',.0f') + ' 元，' if card.credit_limit else ''}"
                    f"单日交易限额 {card.daily_txn_limit:,.0f} 元。",
            gate_checks=checks,
        )

    op_label = {
        "lock": "锁卡", "unlock": "解锁", "limit_adjust": "额度调整", "loss_report": "挂失",
    }.get(op, op)
    if op == "limit_adjust":
        detail = f"额度调整为 {new_limit:,.0f} 元"
    else:
        detail = {
            "lock": "锁定卡片，暂停交易",
            "unlock": "恢复卡片使用",
            "loss_report": "挂失并立即冻结卡片（不可撤销，需强验证）",
        }[op]
    return CardActionResult(
        card_id=card.card_id, operation=op, tier=tier, status="pending_confirmation",
        message=f"已生成{op_label}请求：尾号 {card.last4} {detail}。"
                f"权限级别：{tier_of_operation('card', op) and ('红色 · 需多因子强验证' if tier == 'red' else '黄色 · 需用户确认')}。",
        gate_checks=checks,
    )


def apply_card_action(cards: list[BankCard], card_id: str, op: str, new_limit: float | None) -> BankCard | None:
    """确认后真正变更卡状态（演示模拟）。"""
    for c in cards:
        if c.card_id != card_id:
            continue
        if op == "lock" or op == "loss_report":
            c.status = "lost" if op == "loss_report" else "locked"
        elif op == "unlock":
            c.status = "normal"
        elif op == "limit_adjust" and new_limit:
            c.credit_limit = new_limit
        return c
    return None
