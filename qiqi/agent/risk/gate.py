"""风控闸门——LLM 的建议必须通过确定性检查才能进入执行。

设计原则（参考 AstraQuant 的 "The LLM proposes. Python physically disposes."）：

    决策可以由 LLM 提出，但**放行与否由确定性代码决定**。
    任何检查项自身抛异常时，按 fail-closed（保守拦截）处理，绝不默认放行。

这解决的是大模型金融 Agent 最危险的失效模式：
LLM 给出一个看起来合理、但在数学上不可执行或违反用户章程的建议
（卖超过持仓的数量、用不存在的现金买入、报一个凭空的成交价），
Agent 若直接照做，轻则演示翻车，重则真实亏损。

与 RiskEngine 的分工：
    RiskEngine  评估"当前组合有多危险"（状态评估，产出风险报告）
    RiskGate    判定"这条建议能不能放行"（动作准入，产出通过/拦截）
"""
from __future__ import annotations

import logging
from typing import Optional

from contracts.types import (
    ActionType,
    GateCheck,
    GateResult,
    MarketSnapshot,
    Portfolio,
    Recommendation,
    UserProfile,
)

logger = logging.getLogger(__name__)


class RiskGate:
    """建议准入闸门——所有检查通过才允许执行。

    Args:
        price_tolerance: 建议价与市价的最大偏离比例（默认 20%）。
            LLM 报出的价格若远离行情，说明它在编造数字，必须拦截。
        min_confidence: 置信度硬下限（默认 0.35）。低于此值不仅不放行，
            也不值得占用人工审批队列，直接打回重做。
        max_position_pct: 单标的最大市值占比（默认 50%）。
        concentration_limit: 单行业市值占比上限（默认 50%）。
    """

    def __init__(
        self,
        price_tolerance: float = 0.20,
        min_confidence: float = 0.35,
        max_position_pct: float = 0.50,
        concentration_limit: float = 0.50,
    ):
        self.price_tolerance = price_tolerance
        self.min_confidence = min_confidence
        self.max_position_pct = max_position_pct
        self.concentration_limit = concentration_limit

    # ---- 主入口 ----

    def check(
        self,
        rec: Recommendation,
        portfolio: Portfolio,
        user: UserProfile,
        market: Optional[MarketSnapshot] = None,
    ) -> GateResult:
        """对一条建议做完整准入检查。

        每个检查项独立包裹异常——单项出错只记为该条不通过（fail-closed），
        不影响其余检查继续执行，最终结果仍是拦截。
        """
        checks: list[GateCheck] = []

        checks.append(self._wrap(
            "操作类型有效性", self._check_action, rec, portfolio,
        ))
        checks.append(self._wrap(
            "交易量有效性", self._check_quantity, rec,
        ))
        checks.append(self._wrap(
            "价格合理性", self._check_price, rec, market, portfolio,
        ))
        checks.append(self._wrap(
            "置信度下限", self._check_confidence, rec,
        ))
        checks.append(self._wrap(
            "禁止行业", self._check_forbidden, rec, portfolio, user, market,
        ))
        checks.append(self._wrap(
            "持仓/资金充足性", self._check_capacity, rec, portfolio,
        ))
        checks.append(self._wrap(
            "集中度上限", self._check_concentration, rec, portfolio, market,
        ))

        blocked = [c for c in checks if not c.passed and c.severity == "block"]
        warned = [c for c in checks if not c.passed and c.severity == "warn"]

        fail_closed = any(
            c.name == "检查执行异常" and not c.passed for c in checks
        )

        return GateResult(
            passed=not blocked,
            checks=checks,
            blocked_reasons=[f"{c.name}：{c.detail}" for c in blocked],
            warnings=[f"{c.name}：{c.detail}" for c in warned],
            fail_closed=fail_closed,
        )

    # ---- 异常包装（fail-closed 的核心）----

    @staticmethod
    def _wrap(name: str, fn, *args) -> GateCheck:
        """执行单项检查。任何异常都转为"不通过"，绝不静默放行。"""
        try:
            return fn(*args)
        except Exception as exc:
            logger.warning("风控检查项 [%s] 执行异常：%s", name, exc)
            return GateCheck(
                name="检查执行异常",
                passed=False,
                detail=f"[{name}] 无法完成检查（{exc}），按保守原则拦截",
                severity="block",
            )

    # ---- 各项检查 ----

    @staticmethod
    def _check_action(rec: Recommendation, portfolio: Portfolio) -> GateCheck:
        if not isinstance(rec.action, ActionType):
            return GateCheck(
                name="操作类型有效性", passed=False,
                detail=f"未知操作类型 {rec.action!r}",
            )
        if rec.action in (ActionType.SELL, ActionType.REBALANCE) and not rec.symbol:
            return GateCheck(
                name="操作类型有效性", passed=False,
                detail=f"{rec.action.value}未指定标的",
            )
        return GateCheck(name="操作类型有效性", passed=True,
                         detail=f"操作 {rec.action.value}")

    @staticmethod
    def _check_quantity(rec: Recommendation) -> GateCheck:
        if rec.action == ActionType.HOLD:
            return GateCheck(name="交易量有效性", passed=True, detail="持有，无需交易量")
        if rec.quantity <= 0:
            return GateCheck(
                name="交易量有效性", passed=False,
                detail=f"交易量 {rec.quantity:g} 非正数",
            )
        if rec.quantity != int(rec.quantity):
            return GateCheck(
                name="交易量有效性", passed=False,
                detail=f"交易量 {rec.quantity:g} 非整数股",
            )
        return GateCheck(name="交易量有效性", passed=True,
                         detail=f"{rec.quantity:g} 股")

    def _check_price(
        self,
        rec: Recommendation,
        market: Optional[MarketSnapshot],
        portfolio: Portfolio,
    ) -> GateCheck:
        if rec.action == ActionType.HOLD:
            return GateCheck(name="价格合理性", passed=True, detail="持有，无需价格")
        if rec.price <= 0:
            return GateCheck(
                name="价格合理性", passed=False,
                detail=f"参考价 {rec.price:g} 非正数",
            )

        ref, source = self._reference_price(rec.symbol, market, portfolio)

        if ref is None or ref <= 0:
            # 既无行情也无持仓记录（如买入一个全新标的），无从比对。
            # 不拦截以免完全无法交易，但要明确告知"未能独立验证"。
            return GateCheck(
                name="价格合理性", passed=True, severity="warn",
                detail=f"无 {rec.symbol} 可比对的价格（行情与持仓均无记录），价格未经校验",
            )

        deviation = abs(rec.price - ref) / ref
        if deviation > self.price_tolerance:
            return GateCheck(
                name="价格合理性", passed=False,
                detail=(
                    f"建议价 {rec.price:g} 偏离{source} {ref:g} 达 {deviation:.0%}，"
                    f"超过容忍度 {self.price_tolerance:.0%}，疑似价格错误"
                ),
            )
        return GateCheck(
            name="价格合理性", passed=True,
            detail=f"建议价 {rec.price:g} 与{source} {ref:g} 偏离 {deviation:.1%}",
        )

    @staticmethod
    def _reference_price(
        symbol: str,
        market: Optional[MarketSnapshot],
        portfolio: Portfolio,
    ) -> tuple[Optional[float], str]:
        """取价格校验的参照值：优先实时行情，退而用组合内记录价。

        有行情时以行情为准；行情缺失时用持仓自己的现价兜底，
        这样即便行情源挂掉，"报一个凭空的成交价"仍能被识别出来。
        """
        md = market.data.get(symbol) if market else None
        if md is not None and md.price > 0:
            return md.price, "市价"

        pos = next((p for p in portfolio.positions if p.symbol == symbol), None)
        if pos is not None and pos.current_price > 0:
            return pos.current_price, "持仓记录价"

        return None, ""

    def _check_confidence(self, rec: Recommendation) -> GateCheck:
        if rec.confidence < self.min_confidence:
            return GateCheck(
                name="置信度下限", passed=False,
                detail=(
                    f"置信度 {rec.confidence:.0%} 低于硬下限 {self.min_confidence:.0%}，"
                    f"建议不可靠，打回重做"
                ),
            )
        return GateCheck(name="置信度下限", passed=True,
                         detail=f"置信度 {rec.confidence:.0%}")

    @staticmethod
    def _check_forbidden(
        rec: Recommendation,
        portfolio: Portfolio,
        user: UserProfile,
        market: Optional[MarketSnapshot],
    ) -> GateCheck:
        if not user.forbidden_sectors:
            return GateCheck(name="禁止行业", passed=True, detail="用户未设禁止行业")
        if not rec.symbol:
            return GateCheck(name="禁止行业", passed=True, detail="无标的")

        target_sector = ""
        pos = next((p for p in portfolio.positions if p.symbol == rec.symbol), None)
        if pos:
            target_sector = pos.sector
        elif market and rec.symbol in market.data:
            target_sector = getattr(market.data[rec.symbol], "sector", "") or ""

        if target_sector and target_sector in user.forbidden_sectors:
            # 卖出是减仓，属于合规方向；买入/调仓加仓才是违规
            if rec.action in (ActionType.BUY, ActionType.REBALANCE):
                return GateCheck(
                    name="禁止行业", passed=False,
                    detail=f"{rec.symbol} 属于禁止行业「{target_sector}」，不可买入",
                )
            return GateCheck(
                name="禁止行业", passed=True,
                detail=f"{rec.symbol} 属禁止行业「{target_sector}」，但为卖出减仓，放行",
            )
        return GateCheck(name="禁止行业", passed=True,
                         detail=f"行业「{target_sector or '未知'}」不在禁止列表")

    @staticmethod
    def _check_capacity(
        rec: Recommendation,
        portfolio: Portfolio,
    ) -> GateCheck:
        if rec.action == ActionType.SELL:
            pos = next((p for p in portfolio.positions if p.symbol == rec.symbol), None)
            if pos is None:
                return GateCheck(
                    name="持仓/资金充足性", passed=False,
                    detail=f"组合未持有 {rec.symbol}，无法卖出",
                )
            if rec.quantity > pos.quantity:
                return GateCheck(
                    name="持仓/资金充足性", passed=False,
                    detail=(
                        f"卖出 {rec.quantity:g} 股超过持仓 {pos.quantity:g} 股"
                    ),
                )
            return GateCheck(
                name="持仓/资金充足性", passed=True,
                detail=f"持有 {pos.quantity:g} 股，卖出 {rec.quantity:g} 股",
            )

        if rec.action == ActionType.BUY:
            cost = rec.quantity * rec.price
            if cost > portfolio.cash:
                return GateCheck(
                    name="持仓/资金充足性", passed=False,
                    detail=(
                        f"买入需 {cost:,.0f} 元，可用现金 {portfolio.cash:,.0f} 元，"
                        f"资金不足"
                    ),
                )
            return GateCheck(
                name="持仓/资金充足性", passed=True,
                detail=f"买入 {rec.quantity:g} 股需 {cost:,.0f} 元，现金充足",
            )

        return GateCheck(name="持仓/资金充足性", passed=True, detail="无需资金变动")

    def _check_concentration(
        self,
        rec: Recommendation,
        portfolio: Portfolio,
        market: Optional[MarketSnapshot],
    ) -> GateCheck:
        if rec.action != ActionType.BUY or not rec.symbol:
            return GateCheck(name="集中度上限", passed=True, detail="非买入，不改变集中度")

        pos = next((p for p in portfolio.positions if p.symbol == rec.symbol), None)
        unit_value = pos.current_price if pos and pos.current_price > 0 else rec.price
        target_sector = pos.sector if pos else ""

        post_value = (pos.market_value if pos else 0.0) + unit_value * rec.quantity
        total_after = portfolio.total_value + portfolio.cash

        if total_after <= 0:
            return GateCheck(name="集中度上限", passed=True, severity="warn",
                             detail="组合总资产异常，跳过集中度校验")

        pos_pct = post_value / total_after
        if pos_pct > self.max_position_pct:
            return GateCheck(
                name="集中度上限", passed=False,
                detail=(
                    f"买入后 {rec.symbol} 占比将达 {pos_pct:.0%}，"
                    f"超过单标的上限 {self.max_position_pct:.0%}"
                ),
            )

        sector_pct = 0.0
        if target_sector:
            cur = sum(p.market_value for p in portfolio.positions if p.sector == target_sector)
            extra = 0.0 if pos else unit_value * rec.quantity
            sector_pct = (cur + extra) / total_after
            if sector_pct > self.concentration_limit:
                return GateCheck(
                    name="集中度上限", passed=False,
                    detail=(
                        f"买入后行业「{target_sector}」占比将达 {sector_pct:.0%}，"
                        f"超过行业上限 {self.concentration_limit:.0%}"
                    ),
                )

        detail = f"买入后单标的 {pos_pct:.0%}"
        if target_sector:
            detail += f"、行业「{target_sector}」{sector_pct:.0%}"
        return GateCheck(name="集中度上限", passed=True, detail=detail)


def check_recommendation(
    rec: Recommendation,
    portfolio: Portfolio,
    user: UserProfile,
    market: Optional[MarketSnapshot] = None,
) -> GateResult:
    """快捷函数"""
    return RiskGate().check(rec, portfolio, user, market)
