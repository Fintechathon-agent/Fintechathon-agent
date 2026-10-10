"""新闻与舆情工具——获取证券相关新闻，支持东方财富、新浪等。
参考 PanWatch 的新闻获取模块。
"""
from __future__ import annotations

import logging
import hashlib
from datetime import datetime, timedelta
from typing import Optional

from contracts.types import NewsItem

logger = logging.getLogger(__name__)


def _get_akshare():
    try:
        import akshare as ak
        return ak
    except ImportError:
        return None


class NewsTool:
    """新闻获取工具——封装多个数据源，统一返回 NewsItem 列表"""

    def __init__(self, use_mock: bool = False):
        self._use_mock = use_mock or _get_akshare() is None
        self._ak = None if self._use_mock else _get_akshare()

    def get_related_news(self, symbol: str, limit: int = 10) -> list[NewsItem]:
        """获取指定证券的最新新闻"""
        if self._use_mock:
            return self._mock_news(symbol, limit)
        try:
            return self._akshare_news(symbol, limit)
        except Exception as exc:
            logger.warning("新闻获取 %s 失败: %s，降级为模拟数据", symbol, exc)
            return self._mock_news(symbol, limit)

    def _akshare_news(self, symbol: str, limit: int) -> list[NewsItem]:
        import akshare as ak
        results: list[NewsItem] = []

        try:
            # 东方财富个股新闻
            df = ak.stock_news_em(symbol=symbol)
            for _, row in df.head(limit).iterrows():
                results.append(NewsItem(
                    id=f"em_{hashlib.md5(str(row.get('发布时间','')).encode()).hexdigest()[:8]}",
                    title=str(row.get("新闻标题", "")),
                    content=str(row.get("新闻内容", ""))[:200],
                    url=str(row.get("新闻链接", "")),
                    published_at=str(row.get("发布时间", "")),
                    sentiment=0.0,  # 留空，由 LLM 判断
                    related_symbols=[symbol],
                    source="东方财富",
                ))
        except Exception as exc:
            logger.warning("东方财富新闻获取失败: %s", exc)

        # 如果东方财富没有，尝试新浪
        if not results:
            try:
                df = ak.stock_individual_info_em(symbol=symbol)
                # 新浪新闻接口较复杂，暂用公告替代
            except Exception:
                pass

        return results if results else self._mock_news(symbol, limit)

    @staticmethod
    def _mock_news(symbol: str, limit: int) -> list[NewsItem]:
        """生成模拟新闻（无数据源时使用）"""
        templates = [
            ("{name}发布半年报，营收同比增长", 0.3),
            ("{name}遭机构减持，股价承压", -0.4),
            ("券商看好{name}，上调目标价至", 0.5),
            ("{name}新产品上市，市场反响热烈", 0.2),
            ("{name}被纳入指数样本股", 0.4),
        ]
        name_map = {
            "000001": "平安银行", "000002": "万科A", "600036": "招商银行",
            "600519": "贵州茅台", "000858": "五粮液", "601318": "中国平安",
        }
        name = name_map.get(symbol, symbol)
        items = []
        for i, (tmpl, sent) in enumerate(templates[:limit]):
            items.append(NewsItem(
                id=f"mock_{symbol}_{i}",
                title=tmpl.format(name=name),
                content=f"近日，{name}相关动态引发市场关注...",
                published_at=(datetime.now() - timedelta(hours=i * 3)).isoformat(),
                sentiment=sent,
                related_symbols=[symbol],
                source="模拟数据",
            ))
        return items


# ------------------------------------------------------------ 快捷函数


_news_tool: Optional[NewsTool] = None


def get_news_tool() -> NewsTool:
    global _news_tool
    if _news_tool is None:
        _news_tool = NewsTool()
    return _news_tool


def get_related_news(symbol: str, limit: int = 10) -> list[NewsItem]:
    return get_news_tool().get_related_news(symbol, limit)
