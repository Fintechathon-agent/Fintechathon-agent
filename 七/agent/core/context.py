"""Context 构造器——将用户画像、组合、市场数据、新闻、历史记忆组装成统一上下文。
注意：Context 数据结构定义在 contracts/types.py，本文件只负责构造逻辑。
"""
from __future__ import annotations

from contracts.types import Context, UserProfile, Portfolio, MarketSnapshot, NewsItem, Recommendation


class ContextBuilder:
    """Context 构造器——按阶段逐步填充数据"""

    def __init__(self, user_profile: UserProfile, portfolio: Portfolio, session_id: str = ""):
        self.ctx = Context(
            user_profile=user_profile,
            portfolio=portfolio,
            session_id=session_id,
        )

    def with_market(self, snapshot: MarketSnapshot) -> "ContextBuilder":
        self.ctx.market_snapshot = snapshot
        return self

    def with_news(self, news: list[NewsItem]) -> "ContextBuilder":
        self.ctx.recent_news = news
        return self

    def with_memory(self, summary: str) -> "ContextBuilder":
        self.ctx.memory_summary = summary
        return self

    def with_prev_recommendations(self, recs: list[Recommendation]) -> "ContextBuilder":
        self.ctx.prev_recommendations = recs
        return self

    def build(self) -> Context:
        return self.ctx
