"""Risk Engine——根据用户 Investment Constitution 检查风险边界。
参考 RakshaQuant 的 risk guardrails 和 FinRL_DeepSeek 的风险评估方法。
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from contracts.types import MarketSnapshot, Portfolio, Position, RiskReport, UserProfile, RiskTolerance

logger = logging.getLogger(__name__)


class RiskEngine:
    """风险引擎——检查持仓是否违反用户投资章程"""

    def check(
        self,
        portfolio: Portfolio,
        user: UserProfile,
        market: MarketSnapshot,
        price_history: Optional[dict[str, list[float]]] = None,
    ) -> RiskReport:
        """执行完整风险检查

        price_history: {symbol: [前复权收盘价序列]}（真实数据）。
        提供时 VaR / 最大回撤用历史法精确计算；
        缺省时回退简化估算并在 warnings 中明确标注，绝不把估算冒充精确值。
        """
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

        # 5. VaR 估算：有历史行情用历史法，否则简化估算并标注
        var_95 = self._estimate_var(portfolio, market, price_history)

        # 6. 最大回撤估算：有历史行情按组合价值曲线，否则简化估算并标注
        max_dd = self._estimate_max_drawdown(portfolio, price_history)

        if not price_history:
            warnings.append("VaR/最大回撤为简化估算（缺少历史行情），接入真实数据后自动切换为历史法计算")

        # 7. 持仓相关性：两两日收益 Pearson 系数的等权平均（有历史行情时计算）
        avg_corr = self._avg_correlation(portfolio, price_history)

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
            avg_correlation=avg_corr,
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
    def _align_history(
        portfolio: Portfolio,
        price_history: Optional[dict[str, list[float]]],
    ) -> tuple[list[Position], list[list[float]], int]:
        """按当前市值权重筛选可用历史序列并截齐长度。

        返回 (positions, aligned_series, min_len)；任一持仓序列不足 30 个交易日
        或全部缺失时返回空。
        """
        if not price_history or not portfolio.positions:
            return [], [], 0
        pairs: list[tuple[Position, list[float]]] = []
        for pos in portfolio.positions:
            series = price_history.get(pos.symbol)
            if series and len(series) >= 30:
                pairs.append((pos, series))
        if not pairs:
            return [], [], 0
        min_len = min(len(s) for _, s in pairs)
        aligned = [s[-min_len:] for _, s in pairs]
        return [p for p, _ in pairs], aligned, min_len

    @classmethod
    def _avg_correlation(
        cls,
        portfolio: Portfolio,
        price_history: Optional[dict[str, list[float]]],
    ) -> Optional[float]:
        """持仓两两日收益 Pearson 相关系数的等权平均。

        标准定义：对每对持仓，取同一窗口的日收益率序列求 Pearson 系数，
        再对所有两两组合取简单平均。至少 2 只持仓且窗口 ≥ 10 个收益样本才计算。
        """
        positions, aligned, min_len = cls._align_history(portfolio, price_history)
        if len(positions) < 2 or min_len < 11:
            return None
        returns = []
        for s in aligned:
            returns.append([(s[i] - s[i - 1]) / s[i - 1] for i in range(1, min_len)])
        n = len(returns)
        corrs: list[float] = []
        for i in range(n):
            for j in range(i + 1, n):
                x, y = returns[i], returns[j]
                mean_x = sum(x) / len(x)
                mean_y = sum(y) / len(y)
                cov = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
                var_x = sum((a - mean_x) ** 2 for a in x)
                var_y = sum((b - mean_y) ** 2 for b in y)
                denom = (var_x * var_y) ** 0.5
                if denom > 1e-15:
                    corrs.append(cov / denom)
                else:
                    corrs.append(0.0)
        if not corrs:
            return None
        return round(sum(corrs) / len(corrs), 4)

    @classmethod
    def _estimate_var(
        cls,
        portfolio: Portfolio,
        market: MarketSnapshot,
        price_history: Optional[dict[str, list[float]]] = None,
    ) -> float:
        """95% VaR（%）：历史法取组合日收益序列的 5% 分位数。

        组合日收益 = Σ(市值权重 × 标的日收益)，市值权重取当前时点；
        无历史行情时回退简化估算（仅演示用，调用方会加警告标注）。
        """
        positions, aligned, min_len = cls._align_history(portfolio, price_history)
        if positions and min_len >= 31:
            total_mv = sum(p.market_value for p in positions) or 0.0
            if total_mv > 0:
                weights = [p.market_value / total_mv for p in positions]
                port_returns = []
                for i in range(1, min_len):
                    ret = sum(
                        w * (s[i] - s[i - 1]) / s[i - 1]
                        for w, s in zip(weights, aligned)
                    )
                    port_returns.append(ret)
                sorted_rets = sorted(port_returns)
                # 经验 5% 分位数：与 numpy percentile(method="lower") 一致
                idx = max(0, int(math.ceil(len(sorted_rets) * 0.05)) - 1)
                return round(abs(sorted_rets[idx]) * 100, 2)

        # 回退：仅演示模式。取快照中当日跌幅，放大为近似 95% 分位（非精确）。
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
        return round(abs(var) * 1.65, 2)

    @classmethod
    def _estimate_max_drawdown(
        cls,
        portfolio: Portfolio,
        price_history: Optional[dict[str, list[float]]] = None,
    ) -> float:
        """最大回撤（%）：按组合价值曲线（现金 + Σ 数量×历史价）计算峰值到谷底最大跌幅。

        无历史行情时回退简化估算（仅演示用，调用方会加警告标注）。
        """
        positions, aligned, min_len = cls._align_history(portfolio, price_history)
        if positions and min_len >= 2:
            values = [
                portfolio.cash + sum(p.quantity * s[i] for p, s in zip(positions, aligned))
                for i in range(min_len)
            ]
            peak = values[0]
            max_dd = 0.0
            for v in values:
                if v > peak:
                    peak = v
                dd = (peak - v) / peak * 100 if peak > 0 else 0.0
                if dd > max_dd:
                    max_dd = dd
            return round(max_dd, 2)

        # 回退：仅演示模式。用最差持仓收益率放大估算（非精确）。
        if not portfolio.positions:
            return 0.0
        worst = min((p.return_pct for p in portfolio.positions), default=0.0)
        return round(abs(worst) * 1.5, 2)


def check_portfolio_risk(
    portfolio: Portfolio,
    user: UserProfile,
    market: MarketSnapshot,
) -> RiskReport:
    """快捷函数"""
    return RiskEngine().check(portfolio, user, market)
