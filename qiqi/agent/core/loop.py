"""Agent Run Loop——Harness，控制 Agent 的完整生命周期。
参照 PanWatch / TradingAgents 的多阶段编排，参考 ai-stock-analyst 的 6-agent 分工。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Callable

from contracts.types import (
    AgentPhase,
    AgentResponse,
    ApprovalRequest,
    Context,
    GateResult,
    MarketSnapshot,
    MemoryLayer,
    NewsItem,
    Portfolio,
    Recommendation,
    RiskReport,
    UserProfile,
    WhatIfResult,
    ActionType,
)
from .state import AgentState
from .memory import MemoryStore, MemoryQuery
from .session import Session, SessionManager
from .retry import RetryConfig, RetryableError, retry_on_error

logger = logging.getLogger(__name__)


# ------------------------------------------------------------ 类型别名

ToolMarketFetcher = Callable[[list[str]], MarketSnapshot]
ToolNewsFetcher = Callable[[str], list[NewsItem]]
ToolPortfolioAnalyzer = Callable[[Portfolio, MarketSnapshot], dict]
ToolRiskEngine = Callable[[Portfolio, UserProfile, MarketSnapshot], RiskReport]
ToolDecisionMaker = Callable[[Context, RiskReport], Recommendation]
ToolPaperTrader = Callable[[Recommendation, str], dict]
ToolWhatIf = Callable[[Portfolio, Recommendation, UserProfile, MarketSnapshot, RiskReport], "WhatIfResult"]
ToolRiskGate = Callable[[Recommendation, Portfolio, UserProfile, MarketSnapshot], "GateResult"]
ToolAlternatives = Callable[[Portfolio, UserProfile, MarketSnapshot, RiskReport], list["WhatIfResult"]]


# ------------------------------------------------------------ AgentLoop


@dataclass
class AgentLoop:
    """Agent 运行循环——每个用户请求触发一次完整流程"""

    # 依赖注入（由外部传入具体实现）
    market_fetcher: ToolMarketFetcher
    news_fetcher: ToolNewsFetcher
    portfolio_analyzer: ToolPortfolioAnalyzer
    risk_engine: ToolRiskEngine
    decision_maker: ToolDecisionMaker
    paper_trader: ToolPaperTrader
    memory_store: MemoryStore
    session_manager: SessionManager

    # 可选：情景推演与风控闸门（不传则跳过对应环节）
    whatif_evaluator: Optional[ToolWhatIf] = None
    risk_gate: Optional[ToolRiskGate] = None
    alternatives_scanner: Optional[ToolAlternatives] = None

    # 配置
    retry_config: RetryConfig = field(default_factory=RetryConfig)
    approval_threshold: float = 0.7  # 置信度低于此值需要人工审批

    def run(
        self,
        user_id: str,
        portfolio: Portfolio,
        user_profile: UserProfile,
        question: str = "",
    ) -> AgentResponse:
        """执行完整的 Agent 流程"""
        # 1. 创建或恢复 Session
        session = self.session_manager.create(user_id)
        state = AgentState()
        session.set_phase(AgentPhase.ANALYZING, "理解用户需求")

        try:
            # 2. 收集市场数据
            session.set_phase(AgentPhase.FETCHING_MARKET, "获取行情数据")
            symbols = [p.symbol for p in portfolio.positions]
            market = self._fetch_market_safe(symbols)

            # 3. 获取相关新闻
            session.set_phase(AgentPhase.FETCHING_NEWS, "获取相关新闻")
            top_symbol = portfolio.positions[0].symbol if portfolio.positions else ""
            news = self._fetch_news_safe(top_symbol)

            # 4. 组合分析
            session.set_phase(AgentPhase.ANALYZING, "分析持仓健康状况")
            analysis = self.portfolio_analyzer(portfolio, market)

            # 5. 风险检查
            session.set_phase(AgentPhase.RISK_CHECK, "检查风险边界")
            risk_report = self.risk_engine(portfolio, user_profile, market)

            # 5.1 风险警告写入 observation 层（Hindsight 记忆闭环）
            self._record_observations(user_id, risk_report)

            # 6. 决策生成
            session.set_phase(AgentPhase.DECIDING, "生成决策建议")
            from .context import ContextBuilder
            ctx_builder = ContextBuilder(user_profile, portfolio, session.session_id)
            ctx = (ctx_builder
                   .with_market(market)
                   .with_news(news)
                   .with_memory(self._build_memory_context(user_id, portfolio))
                   .build())

            recommendation = self.decision_maker(ctx, risk_report)

            # 6.1 情景推演——"执行这条建议会发生什么"
            whatif = self._evaluate_whatif(
                portfolio, recommendation, user_profile, market, risk_report,
            )

            # 6.1.1 若主推方案效果不佳，自动扫描备选方案
            alternatives: list[WhatIfResult] = []
            if whatif is not None and whatif.executable and not whatif.net_positive:
                alternatives = self._scan_alternatives(
                    portfolio, user_profile, market, risk_report,
                )

            # 6.2 风控闸门——LLM proposes, Python disposes
            gate = self._check_gate(
                recommendation, portfolio, user_profile, market,
            )

            # 7. 风险提示
            risk_alert = self._build_risk_alert(risk_report, recommendation)

            # 8. 判断是否需要人工审批
            #    闸门拦截的建议一律不放行：不自动执行，也不占用审批队列，
            #    而是带着拦截原因直接返回给用户，让他看到"为什么被挡下"。
            blocked = gate is not None and not gate.passed
            requires_approval = (
                not blocked
                and recommendation.requires_approval(self.approval_threshold)
            )
            approval_req: Optional[ApprovalRequest] = None
            executed = False

            if blocked:
                session.set_phase(AgentPhase.IDLE, "建议被风控拦截")
                risk_alert = self._merge_alert(
                    risk_alert, "⛔ " + "；".join(gate.blocked_reasons)
                )
            elif requires_approval:
                session.set_phase(AgentPhase.AWAITING_APPROVAL, "等待人工审批")
                approval_req = ApprovalRequest(
                    id=f"AR-{session.session_id}-{datetime.now().strftime('%H%M%S')}",
                    recommendation=recommendation,
                    portfolio_snapshot=portfolio,
                    risk_report=risk_report,
                    created_at=datetime.now().isoformat(),
                    user_id=user_profile.user_id,
                )
                state.pending_approval = approval_req
            else:
                # 置信度足够且通过闸门，自动执行 Paper Trade
                session.set_phase(AgentPhase.EXECUTING, "执行纸交易")
                self._execute_paper_trade_safe(recommendation, session.session_id)
                executed = True
                session.set_phase(AgentPhase.IDLE, "完成")

            session.touch()

            return AgentResponse(
                session_id=session.session_id,
                timestamp=datetime.now().isoformat(),
                recommendation=recommendation,
                reasoning=analysis.get("reasoning", ""),
                evidence=recommendation.evidence,
                confidence=recommendation.confidence,
                risk_alert=risk_alert,
                requires_approval=requires_approval,
                approval_request=approval_req,
                portfolio_summary=portfolio,
                risk_report=risk_report,
                next_actions=analysis.get("next_actions", []),
                whatif=whatif,
                alternatives=alternatives,
                gate=gate,
                executed=executed,
            )

        except Exception as exc:
            logger.exception("Agent loop error: %s", exc)
            session.error = str(exc)
            session.set_phase(AgentPhase.ERROR, f"错误：{exc}")
            return AgentResponse(
                session_id=session.session_id,
                timestamp=datetime.now().isoformat(),
                risk_alert=f"系统异常：{exc}",
            )

    # ---- 安全的工具调用（带重试）----

    @retry_on_error(config=None)
    def _fetch_market_safe(self, symbols: list[str]) -> MarketSnapshot:
        return self.market_fetcher(symbols)

    @retry_on_error(config=None)
    def _fetch_news_safe(self, symbol: str) -> list[NewsItem]:
        return self.news_fetcher(symbol)

    @retry_on_error(config=None)
    def _execute_paper_trade_safe(self, rec: Recommendation, session_id: str) -> dict:
        return self.paper_trader(rec, session_id)

    # ---- 辅助方法 ----

    def _evaluate_whatif(
        self,
        portfolio: Portfolio,
        rec: Recommendation,
        user: UserProfile,
        market: MarketSnapshot,
        baseline_risk: RiskReport,
    ) -> Optional[WhatIfResult]:
        """跑情景推演。未注入推演器时返回 None（该环节可选）。"""
        if self.whatif_evaluator is None:
            return None
        try:
            return self.whatif_evaluator(portfolio, rec, user, market, baseline_risk)
        except Exception as exc:
            logger.warning("情景推演失败：%s", exc)
            return None

    def _scan_alternatives(
        self,
        portfolio: Portfolio,
        user: UserProfile,
        market: MarketSnapshot,
        baseline_risk: RiskReport,
    ) -> list[WhatIfResult]:
        """扫描备选方案。未注入扫描器时返回空列表。"""
        if self.alternatives_scanner is None:
            return []
        try:
            return self.alternatives_scanner(portfolio, user, market, baseline_risk)
        except Exception as exc:
            logger.warning("备选方案扫描失败：%s", exc)
            return []

    def _check_gate(
        self,
        rec: Recommendation,
        portfolio: Portfolio,
        user: UserProfile,
        market: MarketSnapshot,
    ) -> Optional[GateResult]:
        """过风控闸门。未注入闸门时返回 None（该环节可选）。"""
        if self.risk_gate is None:
            return None
        try:
            return self.risk_gate(rec, portfolio, user, market)
        except Exception as exc:
            # 闸门自身崩溃必须保守拦截，不能因为"检查器挂了"就放行
            logger.exception("风控闸门执行异常，按 fail-closed 拦截：%s", exc)
            return GateResult(
                passed=False,
                checks=[],
                blocked_reasons=[f"风控闸门执行异常（{exc}），按保守原则拦截"],
                fail_closed=True,
            )

    @staticmethod
    def _merge_alert(existing: str, extra: str) -> str:
        """合并风险提示文案"""
        if not existing:
            return extra
        if not extra:
            return existing
        return f"{existing} {extra}"

    def _record_observations(self, user_id: str, risk_report: RiskReport) -> None:
        """把风险警告写入 observation 层——供 reflect 提炼心智模型。

        按警告类型分类后再写：行业集中度 / 亏损超限 / 综合风险，
        symbols 带上对应主体（行业名或股票代码），使 reflect 能按主体聚类。
        """
        try:
            for w in list(risk_report.warnings)[:3]:
                obs_type, subjects = self._classify_warning(w, risk_report)
                self.memory_store.retain(
                    user_id=user_id,
                    layer=MemoryLayer.OBSERVATION,
                    content=w,
                    source="risk_engine",
                    tags=self._tags_from_text(w),
                    observation_type=obs_type,
                    symbols=subjects,
                )
            if risk_report.risk_score > 70:
                self.memory_store.retain(
                    user_id=user_id,
                    layer=MemoryLayer.OBSERVATION,
                    content=f"组合风险评分 {risk_report.risk_score:.0f}/100，处于高位",
                    source="risk_engine",
                    tags=["risk_score"],
                    observation_type="risk_score_high",
                )
        except Exception as exc:
            logger.warning("写入 observation 记忆失败：%s", exc)

    @staticmethod
    def _classify_warning(warning: str, risk_report: RiskReport) -> tuple[str, list[str]]:
        """判断警告类型并抽出主体（行业名或股票代码）"""
        if "集中度" in warning:
            # 从集中度字典里找出警告指向的行业
            subjects = [s for s in risk_report.sector_concentration if s in warning]
            return "sector_concentration", subjects
        if "亏损" in warning or "止损" in warning:
            return "loss_warning", []
        if "违规" in warning or "禁止" in warning:
            return "forbidden_sector", []
        return "risk_warning", []

    @staticmethod
    def _tags_from_text(text: str) -> list[str]:
        """从警告文本中抽取行业/代码标签"""
        sectors = ["银行", "白酒", "保险", "证券", "医药", "新能源", "半导体", "地产"]
        tags = [s for s in sectors if s in text]
        codes = [w for w in text.replace("（", " ").replace("）", " ").split()
                 if w.isdigit() and len(w) == 6]
        return tags + codes

    def _build_memory_context(self, user_id: str, portfolio: Portfolio) -> str:
        """构建记忆上下文：摘要 + 按当前持仓检索的关联记忆。

        用 recall 取与"行业集中度"相关的历史观察和心智模型，
        让决策能看到"以前是否出现过类似问题"。
        """
        summary = self.memory_store.get_memory_summary(user_id)
        try:
            query = "行业集中度 风险"
            entries = self.memory_store.recall(user_id, query, top_k=3)
            lines = [summary]
            for e in entries:
                tag = "规则" if e.layer == MemoryLayer.MENTAL_MODEL else "观察"
                trust = getattr(e, "trust", "") or "未知"
                lines.append(
                    f"[历史{tag}|来源{e.source}|信任{trust}|置信度{e.confidence:.0%}] "
                    f"{e.content[:60]}"
                )
            return "；".join(lines)
        except Exception:
            return summary

    @staticmethod
    def _build_risk_alert(risk_report: RiskReport, rec: Recommendation) -> str:
        alerts: list[str] = []
        if risk_report.risk_score > 70:
            alerts.append(f"⚠️ 组合风险评分高（{risk_report.risk_score:.0f}/100）")
        if risk_report.forbidden_violations:
            alerts.append(f"⚠️ 存在违规持仓：{[p.symbol for p in risk_report.forbidden_violations]}")
        if rec.confidence < 0.5:
            alerts.append(f"⚠️ 建议置信度较低（{rec.confidence:.0%}），请谨慎评估")
        return " ".join(alerts) if alerts else ""
