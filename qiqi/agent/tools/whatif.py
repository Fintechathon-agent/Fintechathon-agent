"""情景推演引擎——回答"如果执行这条建议，组合会变成什么样"。

对应产品价值主张的最后一环：
    "告诉这个具体用户，现在应该关注什么、为什么，以及**采取行动会发生什么**"

实现方式：把建议应用到组合的**副本**上，用同一套 RiskEngine / 组合分析逻辑
重新评估，输出指标前后对比。全部是本地确定性计算，不依赖 LLM，因此可复现、可验证。

参考 openara-ai/finboard 的"proposed-only"原则：
推演只做假设分析，产出的是"如果这样做会怎样"，不代替执行。
拆不出来的部分明确标注为未知，绝不猜测。
"""
from __future__ import annotations

import copy
from typing import Optional

from contracts.types import (
    ActionType,
    MarketSnapshot,
    MetricDelta,
    Portfolio,
    Position,
    Recommendation,
    RiskReport,
    UserProfile,
    WhatIfResult,
)

# 无法模拟时统一给出的声明（不猜）
_UNMODELED_CAVEATS = [
    "未计入手续费、印花税等交易成本",
    "按当前价即时成交假设，未考虑滑点与冲击成本",
    "行业分类基于当前持仓数据，不构成对未来的判断",
]


def round_lot(quantity: float, ratio: float = 1.0, lot: int = 100) -> float:
    """按整手取整交易量，且保证结果不为 0。

    高位个股（如茅台 1692 元）持仓往往不足一手，直接 int(q*ratio/100)*100
    会得 0，产生"卖出 0 股"这种无法执行的建议。持仓本身不足一手时
    按全部卖出处理。
    """
    target = quantity * ratio
    if target <= 0:
        return 0.0
    if quantity < lot:
        return quantity
    lots = int(target // lot)
    if lots == 0:
        lots = 1
    return min(lots * lot, quantity)


class WhatIfEngine:
    """情景推演引擎——把建议应用到一个组合副本上，重算风险指标。

    Args:
        risk_engine: RiskEngine 实例。传入则用真实风控引擎重算风险评分；
                     不传则退化为纯持仓结构指标（集中度/仓位），仍然可用。
    """

    def __init__(self, risk_engine=None):
        self._risk_engine = risk_engine

    # ---- 主入口 ----

    def evaluate(
        self,
        portfolio: Portfolio,
        rec: Recommendation,
        user: UserProfile,
        market: Optional[MarketSnapshot] = None,
        baseline_risk: Optional[RiskReport] = None,
    ) -> WhatIfResult:
        """推演一条建议的执行后果。

        Args:
            portfolio: 当前组合
            rec: 待评估的建议
            user: 用户画像（风险约束来源）
            market: 行情快照（用于重算风险）
            baseline_risk: 已有的基线风险报告，避免重复计算

        Returns:
            WhatIfResult，含逐项指标对比与综合结论
        """
        scenario = self._describe(rec)
        before = baseline_risk or self._risk_of(portfolio, user, market)

        simulated, error = self._apply(portfolio, rec, market)
        if simulated is None:
            return WhatIfResult(
                scenario=scenario,
                executable=False,
                infeasible_reason=error,
                verdict=f"该建议在当前组合下无法执行：{error}",
            )

        after = self._risk_of(simulated, user, market)

        deltas = self._build_deltas(portfolio, simulated, before, after)
        counted = [d for d in deltas if d.counted]

        # 无变化既不算改善也不算恶化——否则"原地不动"会被包装成正面结论
        improved = sum(1 for d in counted if abs(d.delta) > 1e-9 and d.improved)
        worsened = sum(1 for d in counted if abs(d.delta) > 1e-9 and not d.improved)
        unchanged = sum(1 for d in counted if abs(d.delta) <= 1e-9)

        net_risk = after.risk_score - before.risk_score

        return WhatIfResult(
            scenario=scenario,
            executable=True,
            deltas=deltas,
            improved_count=improved,
            worsened_count=worsened,
            unchanged_count=unchanged,
            net_risk_delta=round(net_risk, 1),
            verdict=self._verdict(improved, worsened, unchanged, net_risk),
            caveats=list(_UNMODELED_CAVEATS),
        )

    # ---- 反事实搜索 ----

    def scan_alternatives(
        self,
        portfolio: Portfolio,
        user: UserProfile,
        market: Optional[MarketSnapshot] = None,
        baseline_risk: Optional[RiskReport] = None,
        top_n: int = 3,
        ratios: tuple[float, ...] = (0.3, 1.0),
    ) -> list[WhatIfResult]:
        """扫描备选方案——主推建议效果不佳时，回答"那有没有更好的做法"。

        对每只持仓尝试不同减持力度，逐个推演后果，按
        （改善数 − 恶化数，风险降幅）排序返回前 N 个。

        这是"反事实推理"最实用的形态：不问"凭什么"，而问"换成那样会怎样"。
        全部为本地确定性计算，无 LLM 参与，结果可复现。
        """
        baseline = baseline_risk or self._risk_of(portfolio, user, market)
        candidates: list[tuple[float, float, WhatIfResult]] = []
        seen: set[tuple[str, float]] = set()

        for pos in portfolio.positions:
            if pos.quantity <= 0 or pos.current_price <= 0:
                continue
            for ratio in ratios:
                qty = round_lot(pos.quantity, ratio)
                if qty <= 0:
                    continue
                # 持仓不足一手时不同力度会得到同一个数量，去重避免重复方案
                key = (pos.symbol, qty)
                if key in seen:
                    continue
                seen.add(key)

                label = "清仓" if qty >= pos.quantity else f"减持{ratio:.0%}"
                rec = Recommendation(
                    action=ActionType.SELL,
                    symbol=pos.symbol,
                    quantity=qty,
                    price=pos.current_price,
                    reason=f"备选方案：{pos.name}{label}",
                    confidence=0.6,
                )
                result = self.evaluate(
                    portfolio, rec, user, market, baseline,
                )
                if not result.executable:
                    continue

                # 排序依据：净改善项数 → 风险降幅 → 改善数（用于区分同为净 0 的方案）
                score = (
                    result.improved_count - result.worsened_count,
                    -result.net_risk_delta,
                    result.improved_count,
                )
                candidates.append((score, result))

        candidates.sort(key=lambda c: c[0], reverse=True)
        return [c[1] for c in candidates[:top_n]]

    # ---- 建议应用 ----

    def _apply(
        self,
        portfolio: Portfolio,
        rec: Recommendation,
        market: Optional[MarketSnapshot],
    ) -> tuple[Optional[Portfolio], str]:
        """把建议应用到组合副本。返回 (新组合, 错误原因)。"""
        sim = copy.deepcopy(portfolio)
        action = rec.action

        if action == ActionType.HOLD:
            return sim, ""

        if action == ActionType.REBALANCE:
            return None, "调仓涉及多笔交易，需要拆分为具体买卖单后逐笔推演"

        if rec.quantity <= 0:
            return None, f"{action.value}数量为 {rec.quantity}，非有效交易量"

        if rec.price <= 0:
            return None, f"参考价 {rec.price} 无效，无法估算资金变化"

        if action == ActionType.SELL:
            return self._apply_sell(sim, rec)

        if action == ActionType.BUY:
            return self._apply_buy(sim, rec, market)

        return None, f"暂不支持的操作类型：{action.value}"

    @staticmethod
    def _apply_sell(sim: Portfolio, rec: Recommendation) -> tuple[Optional[Portfolio], str]:
        pos = next((p for p in sim.positions if p.symbol == rec.symbol), None)
        if pos is None:
            return None, f"组合中未持有 {rec.symbol}，无法卖出"

        if rec.quantity > pos.quantity:
            return None, (
                f"卖出数量 {rec.quantity:g} 股超过持仓 {pos.quantity:g} 股"
            )

        # 卖出净回款 = 金额 - 佣金万三 - 印花税万五（ETF/LOF 免印花税，与回测/纸交易同口径）
        from .fund_ops import is_exchange_fund
        stamp = 0.0 if is_exchange_fund(rec.symbol) else 0.0005
        proceeds = rec.quantity * rec.price * (1 - 0.0003 - stamp)
        remaining = pos.quantity - rec.quantity

        if remaining <= 1e-9:
            sim.positions = [p for p in sim.positions if p.symbol != rec.symbol]
        else:
            pos.quantity = remaining
            pos.market_value = round(pos.current_price * remaining, 2)

        sim.cash = round(sim.cash + proceeds, 2)
        sim.total_value = round(sum(p.market_value for p in sim.positions), 2)
        return sim, ""

    @staticmethod
    def _apply_buy(
        sim: Portfolio,
        rec: Recommendation,
        market: Optional[MarketSnapshot],
    ) -> tuple[Optional[Portfolio], str]:
        # 买入总成本含佣金万三（与回测/纸交易同口径）
        cost = rec.quantity * rec.price * (1 + 0.0003)
        if cost > sim.cash + 1e-6:
            return None, (
                f"买入需 {cost:,.0f} 元，可用现金仅 {sim.cash:,.0f} 元"
            )

        pos = next((p for p in sim.positions if p.symbol == rec.symbol), None)
        if pos is not None:
            total_qty = pos.quantity + rec.quantity
            # 加权平均成本（含佣金）
            pos.avg_cost = round(
                (pos.avg_cost * pos.quantity + cost) / total_qty, 4
            )
            pos.quantity = total_qty
            pos.market_value = round(pos.current_price * total_qty, 2)
            pos.return_pct = round(
                (pos.current_price - pos.avg_cost) / pos.avg_cost * 100, 2
            ) if pos.avg_cost else 0.0
        else:
            md = market.data.get(rec.symbol) if market else None
            cur_price = md.price if md and md.price > 0 else rec.price
            sim.positions.append(Position(
                symbol=rec.symbol,
                name=md.name if md else rec.symbol,
                quantity=rec.quantity,
                avg_cost=round(rec.price * (1 + 0.0003), 4),
                current_price=cur_price,
                market_value=round(rec.quantity * cur_price, 2),
                return_pct=0.0,
                sector=md.sector if md and hasattr(md, "sector") else "",
                asset_type="stock",
            ))

        sim.cash = round(sim.cash - cost, 2)
        sim.total_value = round(sum(p.market_value for p in sim.positions), 2)
        return sim, ""

    # ---- 指标计算 ----

    def _risk_of(
        self,
        portfolio: Portfolio,
        user: UserProfile,
        market: Optional[MarketSnapshot],
    ) -> RiskReport:
        """对给定组合求风险报告；无 risk_engine 时退化为一个空报告"""
        if self._risk_engine is not None:
            try:
                return self._risk_engine.check(portfolio, user, market)
            except Exception:
                pass
        return RiskReport(
            portfolio_id=portfolio.user_id,
            generated_at="",
        )

    @staticmethod
    def _max_sector_pct(portfolio: Portfolio) -> float:
        alloc = portfolio.sector_allocation()
        return max(alloc.values()) * 100 if alloc else 0.0

    @staticmethod
    def _cash_ratio(portfolio: Portfolio) -> float:
        total = portfolio.total_value + portfolio.cash
        return portfolio.cash / total * 100 if total > 0 else 0.0

    def _build_deltas(
        self,
        before_pf: Portfolio,
        after_pf: Portfolio,
        before_risk: RiskReport,
        after_risk: RiskReport,
    ) -> list[MetricDelta]:
        """构造前后对比的指标列表。

        counted=True 的指标参与"改善/恶化"计数；False 的仅展示。
        """
        deltas = [
            MetricDelta(
                metric="最大行业集中度",
                before=round(self._max_sector_pct(before_pf), 1),
                after=round(self._max_sector_pct(after_pf), 1),
                unit="%", higher_is_better=False, counted=True,
            ),
            # 最大集中度会掩盖结构性变化：卖 A 行业会让 B 行业占比被动上升，
            # 两者可能抵消到"最大值不变"。超限行业数能抓住这种恶化。
            MetricDelta(
                metric="超限行业数（>30%）",
                before=self._over_limit_sectors(before_pf),
                after=self._over_limit_sectors(after_pf),
                unit="个", higher_is_better=False, counted=True,
            ),
            MetricDelta(
                metric="风险评分",
                before=round(before_risk.risk_score, 1),
                after=round(after_risk.risk_score, 1),
                unit="分", higher_is_better=False, counted=True,
            ),
            MetricDelta(
                metric="VaR(95%)",
                before=round(before_risk.var_95, 2),
                after=round(after_risk.var_95, 2),
                unit="%", higher_is_better=False, counted=True,
            ),
            MetricDelta(
                metric="持仓数量",
                before=len(before_pf.positions),
                after=len(after_pf.positions),
                unit="只", higher_is_better=True, counted=True,
            ),
            MetricDelta(
                metric="现金比例",
                before=round(self._cash_ratio(before_pf), 1),
                after=round(self._cash_ratio(after_pf), 1),
                unit="%", higher_is_better=False, counted=False,
            ),
            MetricDelta(
                metric="现金余额",
                before=round(before_pf.cash, 2),
                after=round(after_pf.cash, 2),
                unit="元", higher_is_better=True, counted=False,
            ),
        ]
        return deltas

    @staticmethod
    def _over_limit_sectors(portfolio: Portfolio, limit: float = 0.30) -> int:
        """超过集中度上限的行业个数"""
        return sum(1 for pct in portfolio.sector_allocation().values() if pct > limit)

    # ---- 文案 ----

    @staticmethod
    def _describe(rec: Recommendation) -> str:
        if rec.action == ActionType.HOLD:
            return "保持现状，不做交易"
        if rec.quantity:
            return f"{rec.action.value} {rec.symbol} {rec.quantity:g}股 @{rec.price:g}"
        return f"{rec.action.value} {rec.symbol}".strip()

    @staticmethod
    def _verdict(
        improved: int,
        worsened: int,
        unchanged: int,
        net_risk: float,
    ) -> str:
        if improved == 0 and worsened == 0:
            return "执行前后各项风险指标均无变化，该操作对组合结构没有实质影响。"

        risk_word = (
            "风险下降" if net_risk < -1
            else ("风险上升" if net_risk > 1 else "风险评分持平")
        )
        if improved > worsened:
            tone = "建议执行"
        elif worsened > improved:
            tone = "需谨慎评估"
        else:
            tone = "效果中性，可结合个人判断"

        parts = []
        if improved:
            parts.append(f"{improved} 项改善")
        if worsened:
            parts.append(f"{worsened} 项恶化")
        if unchanged:
            parts.append(f"{unchanged} 项无变化")

        return (
            f"执行后 {'、'.join(parts)}，{risk_word}"
            f"（评分 {net_risk:+.1f} 分），{tone}。"
        )
