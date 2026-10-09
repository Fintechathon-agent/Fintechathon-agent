"""组合分析工具——持仓健康检查、行业分布、相关性、收益率统计。
参考 ai-stock-analyst 的 Portfolio agent 和 PanWatch 的组合分析模块。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from contracts.types import MarketSnapshot, Portfolio, Position, Recommendation, ActionType


@dataclass
class PortfolioHealthReport:
    """组合健康报告"""
    total_value: float
    cash: float
    position_count: int
    winning_positions: int          # 盈利持仓数
    losing_positions: int           # 亏损持仓数
    top_gain: tuple[str, float]     # 涨幅最大 (symbol, return_pct)
    top_loss: tuple[str, float]     # 跌幅最大 (symbol, return_pct)
    sector_concentration: dict[str, float]   # 行业分布 {行业: 占比}
    avg_return: float               # 平均收益率 %
    total_return_pct: float         # 组合总收益率 %
    risk_warnings: list[str]        # 风险提示
    reasoning: str                  # 分析推理过程
    next_actions: list[str]         # 下一步建议


class PortfolioAnalyzer:
    """组合分析器"""

    def analyze(self, portfolio: Portfolio, market: MarketSnapshot) -> PortfolioHealthReport:
        """完整组合健康检查"""
        positions = portfolio.positions
        winning = sum(1 for p in positions if p.is_profitable)
        losing = len(positions) - winning

        # 更新行情（用 market 数据覆盖持仓的当前价）
        updated = self._apply_market_data(portfolio, market)

        # 找涨跌最大
        if updated:
            sorted_by_return = sorted(updated, key=lambda p: p.return_pct)
            top_gain = (sorted_by_return[-1].symbol, sorted_by_return[-1].return_pct) if sorted_by_return else ("", 0.0)
            top_loss = (sorted_by_return[0].symbol, sorted_by_return[0].return_pct) if sorted_by_return else ("", 0.0)
        else:
            top_gain = top_loss = ("", 0.0)

        # 行业集中度
        sector_alloc = portfolio.sector_allocation()
        concentrated_sectors = {s: v for s, v in sector_alloc.items() if v > 0.3}

        # 风险提示
        warnings = []
        if concentrated_sectors:
            warnings.append(f"行业集中度过高：{', '.join(concentrated_sectors.keys())} 占比>30%")
        if losing > winning:
            warnings.append(f"亏损持仓居多（{losing}只），注意止损")
        if not positions:
            warnings.append("组合为空，建议适当配置")

        # 推理过程
        reasoning = (
            f"组合共{len(positions)}只持仓，"
            f"盈利{winning}只、亏损{losing}只，"
            f"总市值{portfolio.total_value:.2f}元，"
            f"{'现金充足，可考虑加仓' if portfolio.cash > portfolio.total_value * 0.3 else '建议保持一定现金储备'}。"
        )

        next_actions = []
        if losing > len(positions) * 0.5:
            next_actions.append("建议检视亏损持仓，考虑止损或加仓摊薄成本")
        if portfolio.cash > portfolio.total_value * 0.5:
            next_actions.append("现金比例过高，建议适当布局低估资产")
        if concentrated_sectors:
            next_actions.append(f"建议分散{', '.join(concentrated_sectors.keys())}行业持仓")

        return PortfolioHealthReport(
            total_value=portfolio.total_value,
            cash=portfolio.cash,
            position_count=len(positions),
            winning_positions=winning,
            losing_positions=losing,
            top_gain=top_gain,
            top_loss=top_loss,
            sector_concentration=sector_alloc,
            avg_return=sum(p.return_pct for p in updated) / len(updated) if updated else 0.0,
            total_return_pct=portfolio.total_return,
            risk_warnings=warnings,
            reasoning=reasoning,
            next_actions=next_actions,
        )

    def _apply_market_data(self, portfolio: Portfolio, market: MarketSnapshot) -> list[Position]:
        """用实时行情更新持仓价格"""
        updated = []
        for pos in portfolio.positions:
            md = market.data.get(pos.symbol)
            if md and md.price > 0:
                pos.current_price = md.price
                pos.day_change_pct = md.change_pct
                pos.return_pct = (md.price - pos.avg_cost) / pos.avg_cost * 100
                pos.market_value = md.price * pos.quantity
            updated.append(pos)
        return updated

    def suggest_rebalance(self, portfolio: Portfolio, target_allocation: dict[str, float]) -> list[Recommendation]:
        """根据目标行业配置生成调仓建议"""
        current = portfolio.sector_allocation()
        recommendations: list[Recommendation] = []

        for sector, target_pct in target_allocation.items():
            current_pct = current.get(sector, 0.0)
            diff = target_pct - current_pct

            if abs(diff) < 0.05:  # 差异小于5%忽略
                continue

            # 找到该行业市值最大的持仓
            sector_positions = [p for p in portfolio.positions if p.sector == sector]
            if not sector_positions:
                continue

            top_pos = max(sector_positions, key=lambda p: p.market_value)
            action = ActionType.SELL if diff < 0 else ActionType.BUY
            quantity = int(abs(diff) * portfolio.total_value / top_pos.current_price / 100) * 100

            if quantity < 100:  # 最小交易单位
                continue

            recommendations.append(Recommendation(
                action=action,
                symbol=top_pos.symbol,
                quantity=quantity,
                price=top_pos.current_price,
                reason=f"行业配置调整：{sector} {current_pct:.0%}→{target_pct:.0%}",
                confidence=0.75,
                risk_impact=f"{'减仓' if action == ActionType.SELL else '加仓'}{sector}至目标比例",
            ))

        return recommendations


# ------------------------------------------------------------ 快捷函数


def analyze_portfolio(portfolio: Portfolio, market: MarketSnapshot) -> dict:
    """兼容 AgentLoop 接口的便捷包装"""
    report = PortfolioAnalyzer().analyze(portfolio, market)
    return {
        "reasoning": report.reasoning,
        "next_actions": report.next_actions,
        "risk_warnings": report.risk_warnings,
        "total_return_pct": report.total_return_pct,
        "avg_return": report.avg_return,
        "winning_positions": report.winning_positions,
        "losing_positions": report.losing_positions,
    }


def suggest_rebalance(portfolio: Portfolio, target: dict[str, float]) -> list[Recommendation]:
    return PortfolioAnalyzer().suggest_rebalance(portfolio, target)
