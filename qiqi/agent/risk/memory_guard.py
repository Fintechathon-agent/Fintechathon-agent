"""记忆写入门卫——阻止恶意内容（提示注入 / 记忆投毒）进入记忆。

设计原则（与 RiskGate 同源）：

    LLM 可以提出任何东西，但**能不能写进记忆由确定性代码决定**。
    任何可疑内容一律拒绝写入（fail-closed），并留审计记录。

三道检查：
    1. 层写入策略——USER / MENTAL_MODEL 层不接受 retain 直写。
       USER 只由用户画像流程（save_user_profile）写入，MENTAL_MODEL 只由
       reflect 提炼，防止注入内容直接篡改"用户约束"或生成"自我规则"。
    2. 内容检查——注入模式检测 + 长度上限。命中"忽略以上指令"等
       提示注入片段的写入直接拒绝；超长内容截断。
    3. 信任分级——按 source 映射 trust level，随记忆持久化，
       供检索 / 决策侧区分哪些记忆不可信。

参考开源实践：Prompt Guard / LLM Guard 的注入分类、ACF SDK 的
memory provenance 规则、memory-firewall 的写入风险裁决（见项目安全报告）。
"""
from __future__ import annotations

import logging
import re
from enum import IntEnum
from typing import Union

from contracts.types import MemoryLayer

logger = logging.getLogger(__name__)


class MemoryWriteRejected(Exception):
    """记忆写入被门卫拒绝（内容可疑或违反层写入策略）。"""


class TrustLevel(IntEnum):
    """记忆信任等级——数值越大越可信，按名称持久化。"""
    SYSTEM = 4          # 系统自身提炼（reflect 心智模型）
    CONFIRMED = 3       # 用户显式确认（用户画像）
    TOOL = 2            # 确定性工具输出（风控引擎 / 组合快照）
    LLM_DERIVED = 1     # 模型生成（推荐理由、agent 自述）
    UNTRUSTED = 0       # 外部来源（新闻、网页）


MAX_CONTENT_LEN = 200

# source → 信任等级。未收录的 source 按 LLM_DERIVED（偏保守）处理。
SOURCE_TRUST: dict[str, TrustLevel] = {
    "reflect": TrustLevel.SYSTEM,
    "user_profile": TrustLevel.CONFIRMED,
    "risk_engine": TrustLevel.TOOL,
    "portfolio_snapshot": TrustLevel.TOOL,
    "daily_brief": TrustLevel.TOOL,
    "recommendation": TrustLevel.LLM_DERIVED,
    "agent": TrustLevel.LLM_DERIVED,
    "self": TrustLevel.LLM_DERIVED,
    "news": TrustLevel.UNTRUSTED,
    "web": TrustLevel.UNTRUSTED,
    "user_input": TrustLevel.UNTRUSTED,
}

# retain 直写被拒绝的层 → 拒绝原因（系统流程走专属写入路径）
_RETAIN_FORBIDDEN_LAYERS: dict[MemoryLayer, str] = {
    MemoryLayer.USER: "用户约束层只接受用户画像流程写入，拒绝 retain 直写",
    MemoryLayer.MENTAL_MODEL: "心智模型层只接受 reflect 提炼写入，拒绝 retain 直写",
}

# 注入模式（刻意收窄，避免误伤财经文本：
# 必须出现"指令/规则/角色接管"类语义才命中，单纯出现"忽略短期波动"不会命中）
_INJECTION_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(
        r"ignore\s+(all\s+)?(previous|prior|above|earlier|all\s+other)"
        r"\s+(instructions?|rules?|prompts?|commands?|guidelines?)",
        re.I,
    ), "英文忽略指令"),
    (re.compile(
        r"忽略(以上|上述|之前|此前|前面|上面)?(一切|所有|全部)?"
        r"(的)?(指令|命令|提示词?|规则|限制|设定)",
    ), "中文忽略指令"),
    (re.compile(
        r"disregard\s+(all\s+)?(previous|prior|above|earlier)"
        r"\s+(instructions?|rules?|prompts?)",
        re.I,
    ), "英文无视指令"),
    (re.compile(
        r"do\s+not\s+(follow|obey|comply\s+with)\s+(any\s+)?"
        r"(previous|prior|above|earlier|other)\s+(instructions?|rules?|prompts?)",
        re.I,
    ), "英文拒绝遵循指令"),
    (re.compile(
        r"(忘记|忘掉)(以上|之前|此前|前面)?(一切|所有)?(的)?"
        r"(规则|指令|提示|设定|限制)",
    ), "中文忘记规则"),
    (re.compile(
        r"you\s+are\s+now\s+(a\s+|an\s+|the\s+)?"
        r"(system|developer|administrator|admin)\b",
        re.I,
    ), "英文角色接管"),
    (re.compile(
        r"(从现在起|从现在开始)(的)?你?(是|就是|扮演|成为|的身份是)",
    ), "中文角色接管"),
    (re.compile(
        r"你(现在)?(扮演|成为|的身份(是|改为))",
    ), "中文角色扮演"),
    (re.compile(r"system\s*prompt|系统提示(词|语)?"), "提及系统提示词"),
]


def trust_level_for(source: str) -> TrustLevel:
    """按 source 映射信任等级；未知来源按 LLM_DERIVED（偏保守）。"""
    return SOURCE_TRUST.get((source or "").strip().lower(), TrustLevel.LLM_DERIVED)


def parse_trust(value: Union[str, int, TrustLevel, None]) -> TrustLevel:
    """把持久化的 trust 字段解析为 TrustLevel；旧数据缺失时按最低处理。"""
    if isinstance(value, TrustLevel):
        return value
    if isinstance(value, int):
        try:
            return TrustLevel(value)
        except ValueError:
            return TrustLevel.UNTRUSTED
    name = str(value or "").strip().upper()
    try:
        return TrustLevel[name]
    except KeyError:
        return TrustLevel.UNTRUSTED


def max_trust(a: Union[str, int, TrustLevel, None],
              b: Union[str, int, TrustLevel, None]) -> str:
    """返回两者中更高的信任等级名（去重增强时只升不降）。"""
    return max(parse_trust(a), parse_trust(b)).name


def check_content(content: str) -> str:
    """注入模式检测。返回拒绝原因；空串表示通过。"""
    for pattern, label in _INJECTION_PATTERNS:
        match = pattern.search(content or "")
        if match:
            return f"检测到疑似提示注入（{label}）：{match.group(0)[:40]!r}"
    return ""


def sanitize_content(content: str) -> str:
    """截断到长度上限（对确定性工具输出同样生效，防超长内容挤占记忆）。"""
    cleaned = (content or "").strip()
    if len(cleaned) > MAX_CONTENT_LEN:
        cleaned = cleaned[:MAX_CONTENT_LEN - 1] + "…"
    return cleaned


def guard_write(
    layer: MemoryLayer,
    source: str,
    content: str,
    user_id: str = "",
) -> tuple[str, str]:
    """写入门卫：返回 (净化后内容, 信任等级名)；可疑则抛 MemoryWriteRejected。

    顺序：层策略 → 注入检测 → 截断 + 信任分级。任一环节拒绝都留审计记录。
    """
    if layer in _RETAIN_FORBIDDEN_LAYERS:
        reason = _RETAIN_FORBIDDEN_LAYERS[layer]
        _audit_reject(user_id, layer, source, reason)
        raise MemoryWriteRejected(f"[{layer.value}] {reason}")

    reason = check_content(content)
    if reason:
        _audit_reject(user_id, layer, source, reason, content)
        raise MemoryWriteRejected(f"[{layer.value}] {reason}")

    trust = trust_level_for(source)
    return sanitize_content(content), trust.name


def _audit_reject(
    user_id: str,
    layer: MemoryLayer,
    source: str,
    reason: str,
    content: str = "",
) -> None:
    """拦截留痕 + 熔断计数——审计/熔断失败均不影响拦截本身。"""
    try:
        from agent.risk.audit import log_action

        log_action(
            "memory_write_rejected",
            user_id=user_id or "",
            session_id="",
            detail={
                "layer": layer.value,
                "source": source or "",
                "reason": reason,
                "content_preview": (content or "")[:120],
            },
            result="failure",
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("拦截审计写入失败（不影响拦截）：%s", exc)

    try:
        from agent.risk.circuit_breaker import get_breaker

        get_breaker().record_failure(
            "memory_write_rejected",
            {"layer": layer.value, "source": source or "", "reason": reason},
            user_id=user_id or "",
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("拦截熔断计数失败（不影响拦截）：%s", exc)
