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


def find_card_ref(text: str, cards: list[BankCard]) -> bool:
    """文本中是否出现任何卡标识（尾号/银行名/与已有卡匹配的数字串）
    ——用于区分「未指定卡」（追问）与「指定了但匹配不到」（闸门拦截）。"""
    if re.search(r"尾号\s*(\d{4})", text):
        return True
    for c in cards:
        if c.last4 in text:
            return True
    for bank_name in ("平安", "招商", "工商", "建设", "农业", "中国银行", "交通", "浦发", "中信", "民生"):
        if bank_name in text:
            return True
    return False


def parse_card_operation(text: str) -> tuple[str, float | None]:
    """识别卡片操作与额度参数。"""
    if re.search(r"解挂|解除挂失|取消挂失", text):
        op = "loss_release"
    elif re.search(r"(挂失|丢了|不见了|被盗|被偷)", text):
        op = "loss_report"
    elif re.search(r"解锁|恢复使用", text):
        op = "unlock"
    elif re.search(r"锁定|锁卡|冻结|暂时停用|锁一下|锁", text):
        op = "lock"
    elif re.search(r"额度|限额", text):
        op = "limit_adjust"
    else:
        op = "query"

    new_limit: float | None = None
    if op == "limit_adjust":
        # 金额必须出现在额度/限额关键词之后——避免把「尾号8888」里的数字当额度
        m = re.search(r"(?:额度|限额|调到|调整为|调成|提到|改成)\D{0,6}(\d+(?:\.\d+)?)\s*(万|千|百)?\s*(?:元)?", text)
        if m:
            new_limit = float(m.group(1))
            unit = m.group(2)
            new_limit *= {"万": 10000, "千": 1000, "百": 100}.get(unit or "", 1)
    return op, new_limit


def normalize_card_operation(card: BankCard | None, op: str) -> str:
    # Any way of restoring a lost card is a loss release, including older queued unlocks.
    return "loss_release" if card is not None and card.status == "lost" and op == "unlock" else op


def handle_card_action(
    text: str,
    cards: list[BankCard],
) -> CardActionResult:
    """处理卡片操作意图。查询为绿色自动执行；其余进入待确认（黄/红）。

    卡片定位失败时分两种：
      · 查询且未指定卡片 → 返回全量卡列表（绿色自动执行，赛题绿色查询类）；
      · 操作但未指定卡片 → 追问哪张卡（列出候选），不生成待确认动作。
    指定了尾号/银行名但匹配不到（如尾号9999）仍走确定性闸门拦截。
    """
    card = find_card(cards, text)
    op, new_limit = parse_card_operation(text)
    op = normalize_card_operation(card, op)
    if card is None and not find_card_ref(text, cards):
        if op == "query":
            summary = "；".join(
                f"尾号 {c.last4}（{c.bank} {c.card_type}，状态 {c.status}"
                f"{'，额度 ' + format(c.credit_limit, ',.0f') + ' 元' if c.credit_limit else ''}"
                f"，单日限额 {c.daily_txn_limit:,.0f} 元）"
                for c in cards
            )
            return CardActionResult(
                card_id="", operation="query", tier="green", status="executed",
                message=f"您名下共 {len(cards)} 张卡：{summary}。"
                        f"如需操作某张卡，请说明尾号或银行名。",
                gate_checks=[],
            )
        return CardActionResult(
            card_id="", operation=op, tier="green", status="needs_clarification",
            message="请说明要操作哪张卡（尾号或银行名）。您名下的卡："
                    + "；".join(f"尾号 {c.last4}（{c.bank} {c.card_type}）" for c in cards)
                    + "。",
            gate_checks=[],
        )
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
        "lock": "锁卡", "unlock": "解锁", "limit_adjust": "额度调整", "loss_report": "挂失", "loss_release": "解除挂失",
    }.get(op, op)
    if op == "limit_adjust":
        detail = f"额度调整为 {new_limit:,.0f} 元"
    else:
        detail = {
            "lock": "锁定卡片，暂停交易",
            "unlock": "恢复卡片使用",
            "loss_report": "挂失并立即冻结卡片（不可撤销，需强验证）",
            "loss_release": "解除挂失并恢复使用（需强验证）",
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
        elif op in ("unlock", "loss_release"):
            c.status = "normal"
        elif op == "limit_adjust" and new_limit:
            c.credit_limit = new_limit
        return c
    return None
