"""Risk Engine——根据用户 Investment Constitution 检查风险边界。
参考 RakshaQuant 的 risk guardrails 和 FinRL_DeepSeek 的风险评估方法。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from contracts.types import MarketSnapshot, Portfolio, Position, RiskReport, UserProfile, RiskTolerance

logger = logging.getLogger(__name__)


class RiskEngine:
    """风险引擎——检查持仓是否违反用户投资章程"""

    def check(self, portfolio: Portfolio, user: UserProfile, market: MarketSnapshot) -> RiskReport:
        """执行完整风险检查"""
        violations: list[Position] = []
        warnings: list[str] = []
        exceeded: list[str] = []

        # 1. 禁止行业检查
        if user.forbidden_sectors:
            for pos in portfolio.positions:
                if pos.sector in user.forbidden_sectors:
                    violations.append(pos)
                    warnings.append(f"持仓 {pos.name} 属于禁止行业：{pos.sector}")

        # 2. 单笔亏损超限检查
        for pos in portfolio.positions:
            loss_pct = abs(pos.return_pct) if pos.return_pct < 0 else 0.0
            if loss_pct > user.max_single_loss * 100:
                exceeded.append(f"{pos.name} 亏损 {loss_pct:.1f}%，超过单笔限制 {user.max_single_loss*100:.1f}%")
                warnings.append(f"{pos.name} 亏损超限（{loss_pct:.1f}%）")

        # 3. 行业集中度检查（>30% 为高集中）
        sector_alloc = portfolio.sector_allocation()
        for sector, pct in sector_alloc.items():
            if pct > 0.30:
                warnings.append(f"行业集中度过高：{sector} 占比 {pct:.0%}")

        # 4. 风险评分（0-100）
        risk_score = self._calc_risk_score(portfolio, violations, exceeded, sector_alloc, user)

        # 5. VaR 估算（简化版：取持仓中跌幅最大的 N 只估算）
        var_95 = self._estimate_var(portfolio, market)

        # 6. 最大回撤估算
        max_dd = self._estimate_max_drawdown(portfolio)

        return RiskReport(
            portfolio_id=f"{portfolio.user_id}_{portfolio.date}",
            generated_at=datetime.now().isoformat(),
            risk_score=risk_score,
            var_95=var_95,
            max_drawdown=max_dd,
            sector_concentration=sector_alloc,
            forbidden_violations=violations,
            exceeded_limits=exceeded,
            warnings=warnings,
        )

    @staticmethod
    def _calc_risk_score(
        portfolio: Portfolio,
        violations: list[Position],
        exceeded: list[str],
        sector_alloc: dict[str, float],
        user: UserProfile,
    ) -> float:
        """计算综合风险评分 0-100"""
        score = 0.0

        # 基础分（根据风险偏好）
        risk_map = {
            RiskTolerance.CONSERVATIVE: 10,
            RiskTolerance.MODERATE: 30,
            RiskTolerance.AGGRESSIVE: 50,
            RiskTolerance.EXTREME: 70,
        }
        score = risk_map.get(user.risk_tolerance, 30)

        # 违规持仓扣分
        score += len(violations) * 15

        # 超限项目扣分
        score += len(exceeded) * 10

        # 行业集中度：阈值档位 + 超限后的线性递增。
        # 纯档位计分会让"减仓 50%"这类渐进改善完全不可见（评分不动），
        # 加线性项后推演引擎能反映边际变化。
        for pct in sector_alloc.values():
            if pct > 0.4:
                score += 15 + (pct - 0.4) * 40
            elif pct > 0.3:
                score += 8 + (pct - 0.3) * 70

        # 空仓或持仓过于分散/集中
        if not portfolio.positions:
            score += 20
        elif len(portfolio.positions) > 30:
            score -= 5  # 分散本身降低风险

        return min(max(score, 0.0), 100.0)

    @staticmethod
    def _estimate_var(portfolio: Portfolio, market: MarketSnapshot) -> float:
        """简化 VaR：取持仓中跌幅最大的 3 只平均作为 VaR 估算"""
        losses = []
        for pos in portfolio.positions:
            md = market.data.get(pos.symbol) if market else None
            if md:
                losses.append(min(md.change_pct, 0.0))
        if len(losses) >= 3:
            losses.sort()
            var = sum(losses[:3]) / 3
        elif losses:
            var = sum(losses) / len(losses)
        else:
            var = 0.0
        return round(abs(var) * 1.65, 2)  # 近似 95% VaR

    @staticmethod
    def _estimate_max_drawdown(portfolio: Portfolio) -> float:
        """简化最大回撤：用当前收益率估算（实际应看历史净值）"""
        if not portfolio.positions:
            return 0.0
        worst = min((p.return_pct for p in portfolio.positions), default=0.0)
        return round(abs(worst) * 1.5, 2)  # 放大系数估算


def check_portfolio_risk(
    portfolio: Portfolio,
    user: UserProfile,
    market: MarketSnapshot,
) -> RiskReport:
    """快捷函数"""
    return RiskEngine().check(portfolio, user, market)
