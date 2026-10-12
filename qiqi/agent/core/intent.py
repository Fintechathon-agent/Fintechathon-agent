"""确定性自然语言意图解析。

LLM 可以补充表达理解，但权限、执行意图和注入拦截必须由代码兜底。
本模块只负责理财场景的闭集路由，不生成任何金融数字。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from contracts.types import Portfolio
from agent.risk.memory_guard import check_content


IntentName = Literal[
    "diagnose", "advise", "execute", "insufficient", "out_of_scope", "unsafe"
]

DEFAULT_QUESTION = "请检查我的持仓健康状况"


@dataclass
class IntentResult:
    name: IntentName
    label: str
    question: str
    slots: dict = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    blocked: bool = False
    message: str = ""

    @property
    def is_executable(self) -> bool:
        return self.name == "execute" and not self.missing and not self.blocked

    @property
    def direction(self) -> str:
        return str(self.slots.get("action", ""))

    @property
    def symbols(self) -> list[str]:
        symbol = str(self.slots.get("symbol", ""))
        return [symbol] if symbol else []

    @property
    def sell_ratio(self) -> float:
        return float(self.slots.get("ratio", 0) or 0)

    @property
    def horizon(self) -> str:
        return str(self.slots.get("horizon", ""))

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "question": self.question,
            "slots": dict(self.slots),
            "missing": list(self.missing),
            "blocked": self.blocked,
            "message": self.message,
        }


_EXECUTE_RE = re.compile(r"(赎回|卖出|减仓|清仓|买入|加仓|申购|认购|调仓|执行|按.{0,8}方案)")
_ADVISE_RE = re.compile(r"(建议|推荐|要不要|该不该|怎么办|怎么调|怎么处理|是不是该跑)")
_DIAGNOSE_RE = re.compile(r"(体检|看看|检查|分析|诊断|风险|持仓|亏损|收益|集中度)")
_VAGUE_RE = re.compile(r"^(随便|你定|都行|看着办|帮我决定)[吧。！!？?\s]*$")
_OUT_OF_SCOPE_RE = re.compile(r"(机票|酒店|外卖|天气|写代码|写作文|订花|打车)")
_PRIVILEGE_BYPASS_RE = re.compile(
    r"(绕过|跳过|不要|无需|免去|忽略|无视|不必).{0,8}(验证|确认|审批|风控|权限)|"
    r"(直接|立刻|马上).{0,8}(清仓|转账|挂失).{0,8}"
    r"(别问|不用确认|无需确认|不需要确认|不验证|跳过验证|免验证)",
    re.I,
)
_PERCENT_RE = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*[%％]")
_AMOUNT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(万|千)?\s*元")
_QUANTITY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(股|份)")


def parse_intent(
    question: str,
    portfolio: Portfolio,
    llm_client=None,
) -> IntentResult:
    """把口语请求映射为闭集意图与可验证槽位。"""
    text = (question or "").strip()[:500]
    if not text:
        text = DEFAULT_QUESTION

    injection_reason = check_content(text)
    if injection_reason or _PRIVILEGE_BYPASS_RE.search(text):
        reason = injection_reason or "检测到绕过确认、验证或风控的请求"
        return IntentResult(
            name="unsafe",
            label="可疑请求",
            question=text,
            blocked=True,
            message=f"请求已被安全策略拦截：{reason}。权限规则不会因自然语言而改变。",
        )

    if _OUT_OF_SCOPE_RE.search(text):
        return IntentResult(
            name="out_of_scope",
            label="超出理财场景",
            question=text,
            message="当前演示只覆盖持仓诊断、调仓建议和模拟申赎，不能办理该请求。",
        )

    if _VAGUE_RE.match(text):
        return IntentResult(
            name="insufficient",
            label="信息不足",
            question=text,
            missing=["目标"],
            message="我不能替你决定资金操作。你可以说“帮我检查持仓”或明确标的与调整比例。",
        )

    slots = _extract_slots(text, portfolio)
    if _EXECUTE_RE.search(text):
        action = "buy" if re.search(r"(买入|加仓|申购|认购)", text) else "sell"
        slots["action"] = action
        missing: list[str] = []
        if not slots.get("symbol"):
            missing.append("标的")
        if not any(key in slots for key in ("ratio", "amount", "quantity")):
            missing.append("调整比例或数量")
        if action == "buy":
            missing.append("适当性复核")
        message = ""
        if missing:
            message = "执行前还需要确认：" + "、".join(dict.fromkeys(missing)) + "。"
        return IntentResult(
            name="execute",
            label="理财操作",
            question=text,
            slots=slots,
            missing=list(dict.fromkeys(missing)),
            message=message,
        )

    if _ADVISE_RE.search(text):
        return IntentResult("advise", "诊断与建议", text, slots=slots)
    if _DIAGNOSE_RE.search(text):
        return IntentResult("diagnose", "持仓诊断", text, slots=slots)

    return IntentResult(
        name="insufficient",
        label="需要澄清",
        question=text,
        missing=["理财目标"],
        message="我暂时不能确定你要查询、诊断还是执行操作。请补一句你的目标。",
    )


def parse_intent_rules(question: str, portfolio: Portfolio) -> IntentResult:
    """兼容规则决策器的显式入口。"""
    return parse_intent(question, portfolio)


def _extract_slots(text: str, portfolio: Portfolio) -> dict:
    slots: dict = {}
    for position in portfolio.positions:
        if position.symbol in text or position.name in text:
            slots["symbol"] = position.symbol
            slots["name"] = position.name
            break
    else:
        # 口语简称匹配：持仓名去掉前两字（常见"地名/集团"前缀）后在句中出现的，
        # 如「茅台」→ 贵州茅台、「平安」→ 中国平安、「银行」→ 平安银行。
        # 仅作为兜底；全名/代码优先。
        for position in portfolio.positions:
            name = position.name or ""
            if len(name) >= 4 and name[2:] and name[2:] in text:
                slots["symbol"] = position.symbol
                slots["name"] = position.name
                break

    match = _PERCENT_RE.search(text)
    if match:
        pct = float(match.group(1))
        if 0 < pct <= 100:
            slots["ratio"] = pct / 100

    match = _AMOUNT_RE.search(text)
    if match:
        amount = float(match.group(1))
        unit = match.group(2)
        amount *= 10000 if unit == "万" else 1000 if unit == "千" else 1
        if amount > 0:
            slots["amount"] = amount

    match = _QUANTITY_RE.search(text)
    if match and float(match.group(1)) > 0:
        slots["quantity"] = float(match.group(1))
    return slots
