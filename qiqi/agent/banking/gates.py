"""新场景确定性域闸门——fail-closed，与理财 RiskGate 同一设计原则。

原则（对齐 agent/risk/gate.py）：场景语义校验必须由确定性代码完成，
任何检查项自身抛异常按「不通过」处理，绝不默认放行。
LLM 只负责把自然语言翻译成结构化请求，放行与否由本模块决定。
"""
from __future__ import annotations

import logging
import math
from typing import Optional

from contracts.banking import BankCard, Contact, Subscription, TransferRequest

logger = logging.getLogger(__name__)


def _wrap(name: str, fn, *args) -> dict:
    """单项检查包装：异常一律转为拦截。返回 {name, passed, detail, severity}"""
    try:
        return fn(*args)
    except Exception as exc:
        logger.warning("域闸门检查项 [%s] 执行异常：%s", name, exc)
        return {
            "name": "检查执行异常", "passed": False, "severity": "block",
            "detail": f"[{name}] 无法完成检查（{exc}），按保守原则拦截",
        }


def check_transfer(
    req: TransferRequest,
    contacts: list[Contact],
    balance: float,
    daily_cumulative: float,
) -> tuple[bool, list[dict]]:
    """转账闸门：收款人存在、金额有效、余额充足、限额与防重复。

    daily_cumulative 为当日已成功转账累计（不含本笔）；超 1000 元不在此处
    拦截（权限层升级为红色强验证），但必须显式提示为「大额」。
    """
    checks: list[dict] = []

    checks.append(_wrap("收款人有效性", lambda: {
        "name": "收款人有效性",
        "passed": bool(any(
            req.payee in (c.name, c.phone) for c in contacts if c.name or c.phone
        )),
        "severity": "block",
        "detail": (
            f"收款人「{req.payee}」在通讯录中"
            if any(req.payee in (c.name, c.phone) for c in contacts if c.name or c.phone)
            else f"收款人「{req.payee}」不在通讯录中，无法核验身份，已拦截"
        ),
    }))

    checks.append(_wrap("金额有效性", lambda: {
        "name": "金额有效性",
        "passed": math.isfinite(req.amount) and req.amount > 0 and req.amount == round(req.amount, 2),
        "severity": "block",
        "detail": (
            f"金额 {req.amount:.2f} 元有效"
            if req.amount > 0 and req.amount == round(req.amount, 2)
            else f"金额 {req.amount!r} 无效（须为正数且精度到分）"
        ),
    }))

    checks.append(_wrap("余额充足性", lambda: {
        "name": "余额充足性",
        "passed": req.amount <= balance,
        "severity": "block",
        "detail": (
            f"账户余额 {balance:,.2f} 元，转出 {req.amount:,.2f} 元后剩余 {balance - req.amount:,.2f} 元"
            if req.amount <= balance
            else f"账户余额 {balance:,.2f} 元不足转出 {req.amount:,.2f} 元"
        ),
    }))

    big = req.amount + daily_cumulative > 1000.0
    checks.append(_wrap("大额提示", lambda: {
        "name": "大额提示",
        "passed": True,
        "severity": "warn" if big else "info",
        "detail": (
            f"本笔加当日累计达 {req.amount + daily_cumulative:,.2f} 元，超过 1000 元，"
            f"升级为红色权限（多因子强验证）"
            if big else
            f"日累计 {daily_cumulative + req.amount:,.2f} 元，未超过 1000 元黄色线"
        ),
    }))

    blocked = [c for c in checks if not c["passed"] and c["severity"] == "block"]
    return (not blocked), checks


def check_card_operation(
    card: Optional[BankCard],
    operation: str,
    new_limit: Optional[float] = None,
) -> tuple[bool, list[dict]]:
    """卡片操作闸门：卡存在、操作合法、额度在边界内。"""
    checks: list[dict] = []

    checks.append(_wrap("卡片存在性", lambda: {
        "name": "卡片存在性",
        "passed": card is not None,
        "severity": "block",
        "detail": f"卡片尾号 {card.last4}（{card.bank}）" if card else "未找到该卡片，已拦截",
    }))

    if card is not None:
        valid_ops = {"lock", "unlock", "limit_adjust", "loss_report", "loss_release", "query"}
        checks.append(_wrap("操作合法性", lambda: {
            "name": "操作合法性",
            "passed": operation in valid_ops,
            "severity": "block",
            "detail": (
                f"操作「{operation}」合法"
                if operation in valid_ops else f"未知卡片操作「{operation}」"
            ),
        }))

        if operation == "loss_release" or card.status == "lost":
            allowed = operation == "query" or (operation == "loss_release" and card.status == "lost")
            checks.append({"name": "挂失恢复状态", "passed": allowed, "severity": "block",
                           "detail": "挂失卡仅允许查询或强验证解挂" if card.status == "lost" else "该卡未挂失，无需解挂"})
        # 挂失状态机：已挂失的卡不能再挂失；锁定卡可以解锁
        if operation == "loss_report":
            checks.append(_wrap("挂失状态", lambda: {
                "name": "挂失状态",
                "passed": card.status != "lost",
                "severity": "block",
                "detail": (
                    "该卡可挂失" if card.status != "lost"
                    else f"尾号 {card.last4} 已处于挂失状态，无需重复挂失"
                ),
            }))
        if operation == "limit_adjust":
            ok = new_limit is not None and new_limit > 0 and new_limit <= 500_000
            checks.append(_wrap("额度边界", lambda: {
                "name": "额度边界",
                "passed": ok,
                "severity": "block",
                "detail": (
                    f"新额度 {new_limit:,.0f} 元在银行允许范围内（≤500,000）"
                    if ok else f"新额度 {new_limit!r} 超出边界（须 0 < 额度 ≤ 500,000）"
                ),
            }))

    blocked = [c for c in checks if not c["passed"] and c["severity"] == "block"]
    return (not blocked), checks


def check_subscription_cancel(sub: Optional[Subscription]) -> tuple[bool, list[dict]]:
    """订阅取消闸门：订阅存在、未重复取消。"""
    checks: list[dict] = []

    checks.append(_wrap("订阅存在性", lambda: {
        "name": "订阅存在性",
        "passed": sub is not None,
        "severity": "block",
        "detail": f"订阅「{sub.merchant}」存在" if sub else "未找到该订阅，已拦截",
    }))

    if sub is not None:
        checks.append(_wrap("取消状态", lambda: {
            "name": "取消状态",
            "passed": sub.status == "active",
            "severity": "block",
            "detail": (
                "该订阅处于生效中，可取消"
                if sub.status == "active" else f"订阅「{sub.merchant}」已取消，无需重复操作"
            ),
        }))

    blocked = [c for c in checks if not c["passed"] and c["severity"] == "block"]
    return (not blocked), checks
