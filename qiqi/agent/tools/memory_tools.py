"""MCP 风格记忆工具——给 Orchestrator / Agent Loop 直接调用。
提供三个核心接口，对应 Hindsight 的 memory_retain / memory_recall / memory_reflect。
"""
from __future__ import annotations

from typing import Optional

from contracts.types import (
    MemoryEntry,
    MemoryLayer,
    MemoryMentalModel,
)
from agent.core.memory import HindsightMemoryStore


# 全局 store 实例（由 build_orchestrator 初始化时注入）
_store: Optional[HindsightMemoryStore] = None


def init_memory_tools(store: HindsightMemoryStore):
    """由 Orchestrator 在初始化时调用，注入 store 实例"""
    global _store
    _store = store


def _check_store():
    if _store is None:
        raise RuntimeError(
            "记忆工具未初始化，请先调用 init_memory_tools(store)"
        )


# ============================================================
#  MCP 风格 API
# ============================================================


def memory_retain(
    user_id: str,
    layer: str,
    content: str,
    source: str = "agent",
    tags: Optional[list[str]] = None,
    **kwargs,
) -> MemoryEntry:
    """
    【MCP retain】写入一条记忆。

    参数:
        user_id: 用户ID
        layer: 记忆层，"fact" | "experience" | "observation" | "mental_model"
        content: 记忆内容
        source: 来源，如 "market" / "news" / "recommendation" / "self"
        tags: 检索标签列表
        **kwargs: 各层的特殊字段：
            fact 层：verify_after, last_verified
            experience 层：outcome, recommendation_ref, actual_return_pct
            observation 层：observation_type, symbols, market_context
            mental_model 层：rule_text, trigger_conditions, success_count, failure_count

    返回:
        MemoryEntry，写入的记忆
    """
    _check_store()
    layer_enum = MemoryLayer(layer)
    return _store.retain(
        user_id=user_id,
        layer=layer_enum,
        content=content,
        source=source,
        tags=tags or [],
        **kwargs,
    )


def memory_recall(
    user_id: str,
    query: str,
    layers: Optional[list[str]] = None,
    top_k: int = 5,
) -> list[MemoryEntry]:
    """
    【MCP recall】检索记忆（RRF 融合排名）。

    参数:
        user_id: 用户ID
        query: 检索query
        layers: 要检索的层列表，默认全部四层
        top_k: 返回条数

    返回:
        按相关性排序的记忆列表
    """
    _check_store()
    layer_enums = [MemoryLayer(l) for l in layers] if layers else None
    return _store.recall(
        user_id=user_id,
        query=query,
        layers=layer_enums,
        top_k=top_k,
    )


def memory_reflect(user_id: str) -> list[MemoryMentalModel]:
    """
    【MCP reflect】将观察层积累的规律自动提炼为心智模型。

    当同一 observation_type + symbols 的观察出现 >=3 次时，
    自动生成或更新对应的心智模型。

    返回:
        此次生成/更新的心智模型列表
    """
    _check_store()
    return _store.reflect(user_id)


def memory_summary(user_id: str) -> str:
    """获取用户记忆摘要（供 LLM Context 使用）"""
    _check_store()
    return _store.get_memory_summary(user_id)
