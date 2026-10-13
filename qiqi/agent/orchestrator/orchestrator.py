"""Orchestrator——任务编排器，负责组装 Context、调用各模块、汇聚最终响应。
这是模块1（产品与系统架构部）的核心，由 Orchestrator Owner 负责实现细节。
其他 Owner 只需遵守 Contract（contracts/types.py），输出符合规范的数据结构。
"""
from __future__ import annotations

import logging
from typing import Optional, Any

from contracts.types import (
    ActionType,
    AgentResponse,
    Context,
    MarketSnapshot,
    NewsItem,
    Portfolio,
    Recommendation,
    RiskReport,
    UserProfile,
)
from ..core.loop import AgentLoop
from ..core.memory import MemoryStore
from ..core.session import SessionManager
from ..tools.market import MarketDataTool, fetch_market_snapshot
from ..tools.news import NewsTool, get_related_news
from ..tools.portfolio import PortfolioAnalyzer
from ..tools.paper_trade import PaperTradingTool
from ..tools.whatif import WhatIfEngine, round_lot as _round_lot
from ..risk.engine import RiskEngine
from ..risk.gate import RiskGate
from ..risk.audit import AuditLogger, init_audit_logger
from ..risk.approval import ApprovalManager
from ..tools.memory_tools import init_memory_tools

logger = logging.getLogger(__name__)


# ============================================================
#  LLM 感知型 Decision Maker
# ============================================================


class ModelDecisionError(RuntimeError):
    """真实模型联调模式下：模型调用失败，且不允许回退规则决策。"""


class DecisionMaker:
    """决策生成器——有 LLM 时用 FinancialLLM，无 LLM 时用规则降级。

    strict_live=True（真实模型联调模式）：模型失败直接抛 ModelDecisionError，
    绝不回退规则决策、绝不把失败包装成成功结果。
    """

    def __init__(
        self,
        llm_client: Any = None,
        approval_threshold: float = 0.70,
        strict_live: bool = False,
    ):
        self._llm = llm_client
        self._threshold = approval_threshold
        self._financial_llm = None
        self.strict_live = strict_live
        # 决策透明度：供上层把决策来源写进响应与审计
        self.last_source = ""          # "llm" | "rules"
        self.last_raw: dict = {}       # 模型实际返回内容
        self.last_model_error = ""     # 最近一次模型错误（空 = 无错误）

        if self._llm is not None:
            try:
                from ..tools.financial_llm import FinancialLLM
                self._financial_llm = FinancialLLM(self._llm)
                logger.info("FinancialLLM 已接入，决策使用 LLM")
            except Exception as exc:
                self.last_model_error = str(exc)
                if self.strict_live:
                    raise ModelDecisionError(f"FinancialLLM 初始化失败: {exc}")
                logger.warning("FinancialLLM 初始化失败: %s，降级为规则决策", exc)

    def decide(self, ctx: Context, risk_report: RiskReport) -> Recommendation:
        """生成交易建议"""
        # 优先用 LLM
        if self._financial_llm is not None:
            try:
                rec = self._llm_decide(ctx, risk_report)
                self.last_source = "llm"
                self.last_model_error = ""
                return rec
            except Exception as exc:
                self.last_model_error = str(exc)
                if self.strict_live:
                    self.last_source = ""
                    logger.error("真实模型调用失败（不回退）: %s", exc)
                    raise ModelDecisionError(f"模型调用失败: {exc}") from exc
                logger.warning("LLM 决策失败: %s，尝试降级", exc)

        # 降级：基于规则生成建议（仅演示模式允许）
        self.last_source = "rules"
        return self._rule_based_decide(ctx, risk_report)

    def _llm_decide(self, ctx: Context, risk_report: RiskReport) -> Recommendation:
        """使用 LLM 生成决策"""
        risk_report_text = (
            f"风险评分：{risk_report.risk_score:.0f}/100，"
            f"VaR(95%)：{risk_report.var_95:.2f}%，"
            f"最大回撤：{risk_report.max_drawdown:.2f}%，"
            f"警告项：{', '.join(risk_report.warnings) or '无'}"
        )

        result = self._financial_llm.make_decision(
            context=ctx.build_llm_context(),
            risk_report=risk_report_text,
        )
        self.last_raw = result if isinstance(result, dict) else {}

        action_map = {
            "买入": ActionType.BUY,
            "卖出": ActionType.SELL,
            "持有": ActionType.HOLD,
            "调仓": ActionType.REBALANCE,
        }
        action_str = result.get("recommendation", {}).get("action", "持有")
        action = action_map.get(action_str, ActionType.HOLD)

        rec = Recommendation(
            action=action,
            symbol=result.get("recommendation", {}).get("symbol", ""),
            quantity=float(result.get("recommendation", {}).get("quantity", 0)),
            price=float(result.get("recommendation", {}).get("price", 0)),
            reason=result.get("recommendation", {}).get("reason", ""),
            evidence=result.get("recommendation", {}).get("evidence", []),
            confidence=float(result.get("recommendation", {}).get("confidence", 0)),
            risk_impact=result.get("recommendation", {}).get("risk_impact", ""),
            alternative=result.get("recommendation", {}).get("alternative", ""),
        )
        return rec

    @staticmethod
    def _rule_based_decide(ctx: Context, risk_report: RiskReport) -> Recommendation:
        """无 LLM 时的规则降级决策——基于持仓健康和风险报告生成建议"""
        portfolio = ctx.portfolio
        positions = portfolio.positions

        # 0. 用户自然语言意图优先：带标的的买卖指令走意图分支
        #    （数量/价格仍由闸门校验，此处只把"用户要求"翻译成建议）
        if getattr(ctx, "user_question", ""):
            from ..core.intent import parse_intent_rules

            intent = parse_intent_rules(ctx.user_question, portfolio)
            if intent.direction and intent.symbols:
                sym = intent.symbols[0]
                pos = next((p for p in positions if p.symbol == sym), None)
                if intent.direction == "sell" and pos:
                    ratio = intent.sell_ratio or 0.5
                    qty = _round_lot(pos.quantity, ratio)
                    if qty > 0:
                        return Recommendation(
                            action=ActionType.SELL,
                            symbol=sym,
                            quantity=qty,
                            price=pos.current_price,
                            reason=(
                                f"用户要求减持 {pos.name} 约 {ratio:.0%}"
                                + (f"（{intent.horizon}内）" if intent.horizon else "")
                            ),
                            evidence=[
                                f"用户原话：{ctx.user_question}",
                                f"当前持仓 {pos.quantity:g} 股，按 {ratio:.0%} 减持 {qty:g} 股",
                            ],
                            confidence=0.80,
                            risk_impact=f"减持后释放约 {pos.current_price * qty:.0f} 元",
                            alternative="若改变想法，可先观察一个交易周期",
                        )
                elif intent.direction == "buy" and pos:
                    return Recommendation(
                        action=ActionType.BUY,
                        symbol=sym,
                        quantity=100,
                        price=pos.current_price,
                        reason=f"用户要求加仓 {pos.name}",
                        evidence=[
                            f"用户原话：{ctx.user_question}",
                            f"当前价 {pos.current_price:.2f}，试加一手 100 股",
                        ],
                        confidence=0.62,
                        risk_impact="加仓将占用现金（闸门校验资金充足性）",
                        alternative="可先小额定投试仓",
                    )

        # 1. 找跌幅最大且超限的持仓 → 建议卖出
        worst = min(positions, key=lambda p: p.return_pct) if positions else None
        max_loss_threshold = ctx.user_profile.max_single_loss * 100  # 转成 %

        if worst and worst.return_pct < -max_loss_threshold:
            return Recommendation(
                action=ActionType.SELL,
                symbol=worst.symbol,
                quantity=_round_lot(worst.quantity, 0.5),  # 卖出一半
                price=worst.current_price,
                reason=f"亏损超限：{worst.name} 跌 {worst.return_pct:.1f}%，超过上限 {max_loss_threshold:.1f}%",
                evidence=[
                    f"当前亏损 {worst.return_pct:.2f}%",
                    f"超过单笔亏损容忍 {max_loss_threshold:.1f}%",
                    f"所属行业 {worst.sector}",
                ],
                confidence=0.82,
                risk_impact=f"卖出后释放 {worst.market_value * 0.5:.0f} 元仓位",
                alternative="如看好反弹，可持有观察",
            )

        # 2. 行业集中度过高 → 建议减仓并分散
        for sector, pct in risk_report.sector_concentration.items():
            if pct > 0.40:
                # 找到该行业持仓
                sector_pos = [p for p in positions if p.sector == sector]
                if sector_pos:
                    top = max(sector_pos, key=lambda p: p.market_value)
                    return Recommendation(
                        action=ActionType.SELL,
                        symbol=top.symbol,
                        quantity=_round_lot(top.quantity, 0.3),
                        price=top.current_price,
                        reason=f"行业集中度 {sector} 占比 {pct:.0%}，超过 40% 阈值",
                        evidence=[
                            f"{sector} 当前占比 {pct:.0%}",
                            f"最高持仓 {top.name}({top.symbol}) {top.market_value:.0f} 元",
                        ],
                        confidence=0.78,
                        risk_impact=f"减持 {sector} 行业释放 {top.market_value * 0.3:.0f} 元",
                        alternative=f"保持现有 {sector} 持仓，定期监控",
                    )

        # 3. 亏损持仓数过半 → 建议止损
        losing = [p for p in positions if p.return_pct < 0]
        if positions and len(losing) > len(positions) * 0.5:
            # 选亏损最重的 2 只
            worst_two = sorted(positions, key=lambda p: p.return_pct)[:2]
            worst = worst_two[0]
            return Recommendation(
                action=ActionType.SELL,
                symbol=worst.symbol,
                quantity=_round_lot(worst.quantity, 0.3),
                price=worst.current_price,
                reason=f"亏损持仓 {len(losing)}/{len(positions)} 只，占比过半，建议止损",
                evidence=[
                    f"亏损持仓 {len(losing)} 只",
                    f"最大亏损 {worst.name} {worst.return_pct:.1f}%",
                ],
                confidence=0.72,
                risk_impact=f"止损将释放 {worst.market_value * 0.3:.0f} 元",
                alternative="耐心持有，等待反弹",
            )

        # 4. 现金比例过高（>50%）→ 建议适当加仓
        if portfolio.cash > portfolio.total_value * 0.5 and positions:
            top = max(positions, key=lambda p: p.return_pct)
            return Recommendation(
                action=ActionType.BUY,
                symbol=top.symbol,
                quantity=100,
                price=top.current_price,
                reason="现金比例过高（>50%），建议适当布局优质持仓",
                evidence=[
                    f"现金 {portfolio.cash:.0f} 元 / 总市值 {portfolio.total_value:.0f} 元",
                    f"优选 {top.name} 收益率 {top.return_pct:+.1f}%",
                ],
                confidence=0.65,
                risk_impact="加仓将减少现金储备",
                alternative="保持现金，等待更确定的机会",
            )

        # 5. 默认：持有
        return Recommendation(
            action=ActionType.HOLD,
            symbol="",
            quantity=0,
            price=0.0,
            reason="组合无明显异常，暂持不动",
            evidence=[
                f"风险评分 {risk_report.risk_score:.0f}/100",
                f"持仓 {len(positions)} 只，亏损 {len(losing)} 只",
            ],
            confidence=0.90,
            risk_impact="无",
            alternative="定期复检组合健康",
        )


# ============================================================
#  Orchestrator
# ============================================================


class Orchestrator:
    """Orchestrator——协调所有模块，完成用户请求的端到端处理"""

    def __init__(
        self,
        agent_loop: AgentLoop,
        memory_store: MemoryStore,
        session_manager: SessionManager,
        audit_logger: AuditLogger,
        approval_manager: ApprovalManager,
        decision_maker: DecisionMaker,
    ):
        self.loop = agent_loop
        self.memory = memory_store
        self.sessions = session_manager
        self.audit = audit_logger
        self.approvals = approval_manager
        self.decision_maker = decision_maker
        self.portfolio_analyzer = PortfolioAnalyzer()

    def handle_review_request(
        self,
        user_profile: UserProfile,
        portfolio: Portfolio,
        question: str = "",
    ) -> AgentResponse:
        """处理"组合体检"请求——这是 Golden Path 的核心入口"""
        self.audit.log(
            action="portfolio_review",
            user_id=user_profile.user_id,
            session_id="",
            detail={
                "portfolio_value": portfolio.total_value,
                "position_count": portfolio.position_count,
            },
        )

        response = self.loop.run(
            user_id=user_profile.user_id,
            portfolio=portfolio,
            user_profile=user_profile,
            question=question,
        )

        if response.recommendation:
            self.memory.save_recommendation(
                user_profile.user_id,
                response.recommendation,
                response.session_id,
            )

        # 决策透明度：把决策来源/模型状态/原始返回写进统一响应
        dm = self.decision_maker
        response.decision_source = dm.last_source or ""
        response.model_raw = dict(dm.last_raw or {})
        if dm.last_source == "llm":
            response.model_status = "ok"
        elif dm.last_source == "rules":
            response.model_status = (
                "unavailable" if dm.last_model_error else "not_configured"
            )
        else:
            response.model_status = "unavailable"

        return response

    def handle_approval_response(
        self,
        approval_id: str,
        approved: bool,
        comment: str = "",
    ) -> dict:
        """处理用户对审批请求的响应"""
        if approved:
            ok = self.approvals.approve(approval_id, comment)
        else:
            ok = self.approvals.reject(approval_id, comment)

        if not ok:
            return {"success": False, "message": f"审批ID {approval_id} 不存在"}

        request = self.approvals.get(approval_id)
        if not request:
            return {"success": False, "message": "审批请求未找到"}

        if approved and request.recommendation:
            from ..tools.paper_trade import get_paper_trader
            trader = get_paper_trader()
            result = trader.execute(request.recommendation, approval_id)
            self.audit.log(
                action="paper_trade_execution",
                # user_id 取审批归属用户；旧记录可能为空串，退回 "unknown"
                # 而非证券代码（此前误把 symbol 写进 user_id，污染了审计过滤）
                user_id=request.user_id or "unknown",
                session_id=approval_id,
                detail={
                    "action": request.recommendation.action.value,
                    "symbol": request.recommendation.symbol,
                    "quantity": request.recommendation.quantity,
                    "approver_comment": comment,
                    "result": "success" if result.success else "failure",
                },
                result="success" if result.success else "failure",
            )
            return {
                "success": True,
                "message": "审批已通过并执行",
                "trade_result": result.message,
            }

        return {"success": True, "message": f"审批已{'通过' if approved else '拒绝'}"}

    def get_portfolio_health(
        self,
        portfolio: Portfolio,
        market: MarketSnapshot,
    ) -> dict:
        """单独获取组合健康报告（不需要完整 Agent Loop）

        先用行情补全持仓价格与总市值，保证与决策流程看到的是同一组数字。
        """
        _enrich_portfolio_with_market(portfolio, market)
        report = self.portfolio_analyzer.analyze(portfolio, market)
        return {
            "total_value": report.total_value,
            "cash": report.cash,
            "position_count": report.position_count,
            "winning_positions": report.winning_positions,
            "losing_positions": report.losing_positions,
            "top_gain": report.top_gain,
            "top_loss": report.top_loss,
            "sector_concentration": report.sector_concentration,
            "avg_return": report.avg_return,
            "risk_warnings": report.risk_warnings,
            "reasoning": report.reasoning,
            "next_actions": report.next_actions,
        }


# ============================================================
#  构建工厂
# ============================================================


def build_orchestrator(
    llm_client: Any = None,
    config_path: str | None = None,
    strict_live: bool = False,
    price_history_provider: Any = None,
) -> Orchestrator:
    """构建完整的 Orchestrator

    Args:
        llm_client: LLM 客户端（支持 DeepSeek/OpenAI 兼容格式）。
                   传 None 则使用规则降级决策。
        strict_live: True = 真实模型联调模式：模型失败抛错、不回退规则决策。
        price_history_provider: 可调用对象，入参 Portfolio、返回
                   {symbol: [前复权收盘价]}；提供后 VaR/最大回撤用历史法精确计算。
        config_path: config.fund.yaml 路径，默认使用项目根目录下的
    """
    from ..config_fund import load_fund_config
    from ..core.loop import AgentLoop
    from ..risk.circuit_breaker import init_breaker

    cfg = load_fund_config(config_path)
    init_breaker(cfg.breaker_dir)  # 熔断器状态目录（重启后锁定状态保持）

    memory = MemoryStore(cfg.memory_dir)
    init_memory_tools(memory)  # 注册到 MCP 风格工具
    sessions = SessionManager(ttl_minutes=cfg.session.ttl_minutes)
    paper_trader = PaperTradingTool(cfg.paper_trade_dir)
    audit = AuditLogger(cfg.audit_dir)
    init_audit_logger(cfg.audit_dir)
    approvals = ApprovalManager(cfg.approval_dir)

    market_tool = MarketDataTool(use_mock=(cfg.financial.market_source == "mock"))
    news_tool = NewsTool(use_mock=(cfg.financial.news_source == "mock"))
    risk_engine = RiskEngine()
    risk_gate = RiskGate()
    whatif_engine = WhatIfEngine(risk_engine)
    decision_maker = DecisionMaker(
        llm_client,
        approval_threshold=cfg.risk.approval_threshold,
        strict_live=strict_live,
    )

    # ---- 填充持仓实时行情 ----
    def market_fetcher(symbols: list[str]) -> MarketSnapshot:
        # 用实时行情补全持仓的 name / current_price
        snapshot = fetch_market_snapshot(symbols)
        _enrich_positions_with_market(snapshot)
        return snapshot

    def news_fetcher(symbol: str) -> list[NewsItem]:
        return get_related_news(symbol)

    def portfolio_analyzer_fn(portfolio: Portfolio, market: MarketSnapshot) -> dict:
        # 先用实时行情补全持仓
        _enrich_portfolio_with_market(portfolio, market)
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

    def risk_engine_fn(portfolio: Portfolio, user: UserProfile, market: MarketSnapshot) -> RiskReport:
        history = price_history_provider(portfolio) if price_history_provider else None
        return risk_engine.check(portfolio, user, market, price_history=history)

    def decision_maker_fn(ctx: Context, risk_report: RiskReport) -> Recommendation:
        return decision_maker.decide(ctx, risk_report)

    def paper_trader_fn(rec: Recommendation, session_id: str) -> dict:
        result = paper_trader.execute(rec, session_id)
        return {"success": result.success, "message": result.message}

    def whatif_fn(portfolio, rec, user, market, baseline_risk):
        return whatif_engine.evaluate(portfolio, rec, user, market, baseline_risk)

    def risk_gate_fn(rec, portfolio, user, market):
        return risk_gate.check(rec, portfolio, user, market)

    def alternatives_fn(portfolio, user, market, baseline_risk):
        return whatif_engine.scan_alternatives(portfolio, user, market, baseline_risk)

    loop = AgentLoop(
        market_fetcher=market_fetcher,
        news_fetcher=news_fetcher,
        portfolio_analyzer=portfolio_analyzer_fn,
        risk_engine=risk_engine_fn,
        decision_maker=decision_maker_fn,
        paper_trader=paper_trader_fn,
        memory_store=memory,
        session_manager=sessions,
        approval_threshold=cfg.risk.approval_threshold,
        whatif_evaluator=whatif_fn,
        risk_gate=risk_gate_fn,
        alternatives_scanner=alternatives_fn,
        audit_logger=audit,
    )

    return Orchestrator(
        agent_loop=loop,
        memory_store=memory,
        session_manager=sessions,
        audit_logger=audit,
        approval_manager=approvals,
        decision_maker=decision_maker,
    )


# ------------------------------------------------------------ 内部工具


def _enrich_positions_with_market(snapshot: MarketSnapshot) -> None:
    """用实时行情补全 MarketSnapshot 中各标的的名称"""
    for sym, md in snapshot.data.items():
        if not md.name or md.name == sym:
            # 尝试从 name_map 补全
            name_map = {
                "600036": "招商银行", "600519": "贵州茅台", "000001": "平安银行",
                "601318": "中国平安", "000858": "五粮液", "000333": "美的集团",
                "002594": "比亚迪", "600900": "长江电力", "510310": "沪深300ETF",
                "159915": "创业板ETF",
            }
            if sym in name_map:
                md.name = name_map[sym]


def _enrich_portfolio_with_market(portfolio: Portfolio, market: MarketSnapshot) -> None:
    """用实时行情更新持仓的价格和名称，并重算组合总市值。

    重算 total_value 很关键：持仓价更新后若总市值仍是旧值，
    行业占比、现金比例等派生指标会全部失真，推演的前后对比也就失去意义。
    """
    name_map = {
        "600036": "招商银行", "600519": "贵州茅台", "000001": "平安银行",
        "601318": "中国平安", "000858": "五粮液", "000333": "美的集团",
        "002594": "比亚迪", "600900": "长江电力", "510310": "沪深300ETF",
        "159915": "创业板ETF",
    }
    for pos in portfolio.positions:
        md = market.data.get(pos.symbol)
        if md:
            if md.price > 0:
                pos.current_price = md.price
                pos.day_change_pct = md.change_pct
                pos.return_pct = (md.price - pos.avg_cost) / pos.avg_cost * 100
                pos.market_value = md.price * pos.quantity
            if not pos.name or pos.name == pos.symbol:
                pos.name = md.name or name_map.get(pos.symbol, pos.symbol)
        elif not pos.name or pos.name == pos.symbol:
            pos.name = name_map.get(pos.symbol, pos.symbol)
    portfolio.total_value = round(sum(p.market_value for p in portfolio.positions), 2)
