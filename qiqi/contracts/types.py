"""跨模块数据结构Contract——所有模块必须遵守。
任何 Owner 输出不符合此 Contract 的数据结构，由该 Owner 自行修复。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Literal, Optional


# ============================================================
#  用户与组合核心
# ============================================================


class RiskTolerance(Enum):
    """投资偏好等级"""
    CONSERVATIVE = "保守"      # 低风险，低波动
    MODERATE = "稳健"          # 中等风险，追求平衡
    AGGRESSIVE = "积极"        # 高风险，追求高收益
    EXTREME = "激进"           # 极高风险，极高收益


class ExperienceLevel(Enum):
    """投资经验等级"""
    BEGINNER = "小白"
    INTERMEDIATE = "有经验"
    PROFESSIONAL = "专业"


@dataclass
class UserProfile:
    """用户财务画像——所有模块共享"""
    user_id: str
    name: str = ""
    risk_tolerance: RiskTolerance = RiskTolerance.MODERATE
    investment_horizon: str = "1年以内"          # 如 "1年以内" / "3-5年" / "5年以上"
    max_single_loss: float = 0.05               # 单笔最大亏损比例，如 0.05 = 5%
    max_total_loss: float = 0.20                # 整体最大亏损比例
    forbidden_sectors: list[str] = field(default_factory=list)   # 禁止行业，如 ["煤炭", "烟草"]
    annual_income_range: str = ""               # 年收入区间
    experience: ExperienceLevel = ExperienceLevel.INTERMEDIATE
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()


@dataclass
class Position:
    """单个持仓"""
    symbol: str          # 证券代码，如 "000001.XSHE" / "AAPL"
    name: str            # 证券名称
    quantity: float      # 持股数量
    avg_cost: float      # 成本价（元）
    current_price: float # 当前价（元）
    market_value: float  # 市值（元）
    return_pct: float    # 收益率 %，正数盈利负数亏损
    day_change_pct: float = 0.0  # 当日涨跌幅 %
    sector: str = ""     # 行业分类
    asset_type: str = "stock"  # stock / fund / bond / cash

    @property
    def gain_loss(self) -> float:
        """浮动盈亏金额"""
        return (self.current_price - self.avg_cost) * self.quantity

    @property
    def is_profitable(self) -> bool:
        return self.return_pct >= 0


@dataclass
class Portfolio:
    """投资组合——Financial Tools 输出，Risk Engine / Decision Manager 消费"""
    user_id: str
    date: str                      # 快照日期，YYYY-MM-DD
    positions: list[Position] = field(default_factory=list)
    total_value: float = 0.0       # 总市值（元）
    cash: float = 0.0              # 现金（元）
    daily_return: float = 0.0      # 当日收益率 %
    total_return: float = 0.0      # 累计收益率 %
    history: list[dict] = field(default_factory=list)  # 简史，用于绘图

    @property
    def total_assets(self) -> float:
        """总资产 = 市值 + 现金"""
        return self.total_value + self.cash

    @property
    def position_count(self) -> int:
        return len(self.positions)

    def sector_allocation(self) -> dict[str, float]:
        """行业分布，返回 {行业: 占比}"""
        if self.total_value <= 0:
            return {}
        out: dict[str, float] = {}
        for p in self.positions:
            s = p.sector or "未分类"
            out[s] = out.get(s, 0.0) + p.market_value
        return {s: v / self.total_value for s, v in out.items()}


# ============================================================
#  市场与新闻数据
# ============================================================


@dataclass
class MarketData:
    """市场行情——Tools 层统一封装"""
    timestamp: str      # 数据时间，ISO 格式
    symbol: str         # 证券代码
    name: str = ""
    price: float = 0.0  # 当前价
    change_pct: float = 0.0  # 涨跌幅 %
    volume: float = 0.0  # 成交量
    amount: float = 0.0  # 成交额
    high: float = 0.0
    low: float = 0.0
    source: str = ""    # 数据来源，如 "akshare" / "tushare" / "mock"


@dataclass
class NewsItem:
    """新闻条目"""
    id: str
    title: str
    content: str = ""           # 摘要或全文
    url: str = ""
    published_at: str = ""      # 发布时间
    sentiment: float = 0.0      # 情感评分 -1~1
    related_symbols: list[str] = field(default_factory=list)
    source: str = ""            # 新闻来源


# ============================================================
#  风险报告
# ============================================================


@dataclass
class RiskReport:
    """风险报告——Risk Engine 输出"""
    portfolio_id: str
    generated_at: str
    risk_score: float = 0.0         # 0-100 综合风险评分
    var_95: float = 0.0             # 95% VaR（Value at Risk）
    max_drawdown: float = 0.0       # 最大回撤 %
    sector_concentration: dict[str, float] = field(default_factory=dict)  # 行业集中度
    forbidden_violations: list[Position] = field(default_factory=list)    # 违规持仓
    exceeded_limits: list[str] = field(default_factory=list)              # 超限项目
    warnings: list[str] = field(default_factory=list)                    # 风险提示


# ============================================================
#  决策与推荐
# ============================================================


class ActionType(Enum):
    BUY = "买入"
    SELL = "卖出"
    HOLD = "持有"
    REBALANCE = "调仓"


@dataclass
class Recommendation:
    """决策建议——Decision Manager 输出，Human Approval 前必须具备"""
    action: ActionType
    symbol: str
    quantity: float          # 交易数量（股数）
    price: float             # 参考价格（元）
    reason: str              # 理由，≤50字
    evidence: list[str] = field(default_factory=list)   # 证据列表
    confidence: float = 0.0  # 置信度 0~1
    risk_impact: str = ""    # 风险影响说明
    alternative: str = ""    # 备选方案（如被拒绝）
    estimated_impact: str = ""  # 执行后的预估影响

    def requires_approval(self, threshold: float = 0.7) -> bool:
        """置信度低于阈值时需要人工审批"""
        return self.confidence < threshold


@dataclass
class ApprovalRequest:
    """人工审批请求"""
    id: str
    recommendation: Recommendation
    portfolio_snapshot: Portfolio
    risk_report: RiskReport
    created_at: str
    status: Literal["pending", "approved", "rejected", "cancelled"] = "pending"
    approver_comment: str = ""
    user_id: str = ""               # 归属用户（空 = 未标注），供按用户过滤待办


# ============================================================
#  Agent 最终响应
# ============================================================


@dataclass
class AgentResponse:
    """Agent 对用户的最终响应——跨模块统一输出格式"""
    session_id: str
    timestamp: str
    recommendation: Optional[Recommendation] = None
    reasoning: str = ""          # 推理过程（展示给用户）
    evidence: list[str] = field(default_factory=list)   # 引用来源
    confidence: float = 0.0      # 置信度
    risk_alert: str = ""         # 风险提示（如有）
    requires_approval: bool = False
    approval_request: Optional[ApprovalRequest] = None
    portfolio_summary: Optional[Portfolio] = None       # 当前组合快照（展示用）
    risk_report: Optional[RiskReport] = None
    next_actions: list[str] = field(default_factory=list)  # 下一步建议
    whatif: Optional["WhatIfResult"] = None     # 情景推演："执行后会怎样"
    alternatives: list["WhatIfResult"] = field(default_factory=list)  # 备选方案推演（主推不佳时）
    gate: Optional["GateResult"] = None         # 风控闸门结果
    executed: bool = False                      # 是否已实际执行（纸交易）


# ============================================================
#  枚举与常量
# ============================================================


class AgentPhase(Enum):
    """Agent 运行阶段"""
    IDLE = "idle"
    ANALYZING = "analyzing"
    FETCHING_MARKET = "fetching_market"
    FETCHING_NEWS = "fetching_news"
    RISK_CHECK = "risk_check"
    DECIDING = "deciding"
    AWAITING_APPROVAL = "awaiting_approval"
    EXECUTING = "executing"
    ERROR = "error"


# ============================================================
#  Session 与 Memory
# ============================================================


# ============================================================
#  Hindsight 四层记忆（Meta 启发）
# ============================================================


class MemoryLayer(Enum):
    """记忆层分类——对应 Hindsight 四层架构 + 用户画像层"""
    FACT = "fact"           # 世界事实：客观数据、可验证的事实
    EXPERIENCE = "experience"  # 经验：交易结果、推荐反馈
    OBSERVATION = "observation"  # 观察：市场判断、风险识别
    MENTAL_MODEL = "mental_model"  # 心智模型：自我生成的规则
    USER = "user"           # 用户记忆：用户明确提供或确认的偏好/约束/授权


@dataclass
class MemoryEntry:
    """单条记忆——所有四层共享的基础结构"""
    id: str = ""
    layer: MemoryLayer = MemoryLayer.FACT
    content: str = ""                    # 记忆内容原文
    created_at: str = ""                 # 创建时间
    updated_at: str = ""                 # 更新时间（用于信心演化）
    confidence: float = 1.0         # 置信度 0~1，随证据演化
    source: str = ""                # 来源：market / news / recommendation / self
    tags: list[str] = field(default_factory=list)    # 检索标签
    superseded_by: str = ""         # 被哪条记忆替代（用于心智模型更新链）
    supporting_ids: list[str] = field(default_factory=list)  # 支持该记忆的其他记忆ID
    contradictory_ids: list[str] = field(default_factory=list)  # 与该记忆矛盾的ID

    def is_stale(self, threshold: float = 0.3) -> bool:
        """置信度低于阈值认为过时"""
        return self.confidence < threshold


@dataclass
class MemoryFact(MemoryEntry):
    """世界事实层——客观可验证的数据"""
    # layer 从 MemoryEntry 继承，构造时由 retain() 传入
    verify_after: str = ""          # 下次验证时间（ISO日期）
    last_verified: str = ""         # 上次验证时间


@dataclass
class MemoryExperience(MemoryEntry):
    """经验层——交易结果、推荐反馈"""
    outcome: str = ""               # 结果：profit / loss / pending / rejected
    recommendation_ref: str = ""    # 关联的 Recommendation ID
    actual_return_pct: float = 0.0  # 实际收益率


@dataclass
class MemoryObservation(MemoryEntry):
    """观察层——市场判断、风险识别"""
    observation_type: str = ""      # sector_alert / risk_warning / trend_signal / ...
    symbols: list[str] = field(default_factory=list)
    market_context: str = ""        # 当时的市场环境描述


@dataclass
class MemoryMentalModel(MemoryEntry):
    """心智模型层——自我生成的规则"""
    rule_text: str = ""             # 规则原文，如 "银行占比>40%要减仓"
    trigger_conditions: list[str] = field(default_factory=list)  # 触发条件
    success_count: int = 0          # 规则被验证成功的次数
    failure_count: int = 0          # 规则被验证失败的次数
    version: int = 1                # 版本号，每次更新+1


@dataclass
class MemoryUser(MemoryEntry):
    """用户记忆层——用户明确提供或确认的偏好、约束与授权。

    与模型推断严格区分：`confirmed_by_user=False` 表示该条目来自配置默认值
    或导入，只是"系统当前采用的假设"，**不得**据此认定用户已确认风险承受能力；
    只有用户显式确认的条目才置 True（约束：不得由模型推断擅自写入）。
    授权类条目（preference_type="authorization"）才代表交易许可范围。
    """
    preference_type: str = ""       # risk_tolerance / horizon / loss_limit /
                                    # forbidden_sector / authorization / analysis_pref
    confirmed_by_user: bool = False  # 是否由用户显式确认（默认值/推断=False）
    scope: str = ""                 # 适用范围，如 "portfolio" / "trading" / "analysis"


@dataclass
class SessionRecord:
    """会话记录——Memory 持久化单位"""
    session_id: str
    user_id: str
    created_at: str
    last_active: str
    phase: str
    portfolio_snapshot: Optional[Portfolio] = None
    recommendations: list[Recommendation] = field(default_factory=list)
    user_feedback: str = ""
    errors: list[str] = field(default_factory=list)
    memory_summary: str = ""        # 该会话结束时写入的四层记忆摘要


# ============================================================
#  情景推演（"采取行动会发生什么"）
# ============================================================


@dataclass
class MetricDelta:
    """单项指标的前后对比"""
    metric: str             # 指标名，如 "最大行业集中度"
    before: float
    after: float
    unit: str = ""          # 单位：% / 分 / 元 / 只
    higher_is_better: bool = False   # 该指标越大越好还是越小越好
    counted: bool = True    # 是否计入"改善/恶化"统计（False 则仅展示）

    @property
    def delta(self) -> float:
        return self.after - self.before

    @property
    def improved(self) -> bool:
        """执行后是否改善"""
        if abs(self.delta) < 1e-9:
            return True
        return (self.delta > 0) == self.higher_is_better

    def format(self) -> str:
        """人话描述，如 '最大行业集中度：86.1% → 60.3%（↓25.8）'"""
        def fmt(v: float) -> str:
            if self.unit == "元":
                return f"{v:,.0f}"
            if self.unit in ("%", "分"):
                return f"{v:.1f}"
            return f"{v:g}"
        arrow = "→"
        d = abs(self.delta)
        if d < 1e-9:
            return f"{self.metric}：{fmt(self.before)}{self.unit} {arrow} 持平"
        sign = "↓" if self.delta < 0 else "↑"
        return (
            f"{self.metric}：{fmt(self.before)}{self.unit} {arrow} "
            f"{fmt(self.after)}{self.unit}（{sign}{fmt(d)}）"
        )


@dataclass
class WhatIfResult:
    """情景推演结果——"如果执行这条建议，组合会变成什么样"

    对应核心价值主张的最后一环："采取行动会发生什么"。
    由 WhatIfEngine 在 DecisionMaker 产出建议后计算，纯本地确定性计算。
    """
    scenario: str                           # 情景描述，如 "卖出 平安银行 1500股 @10.5"
    executable: bool = True                 # 该建议在数学上是否可执行
    infeasible_reason: str = ""             # 不可执行的原因
    deltas: list[MetricDelta] = field(default_factory=list)
    improved_count: int = 0                 # 明确改善的指标数（不含无变化）
    worsened_count: int = 0                 # 明确恶化的指标数（不含无变化）
    unchanged_count: int = 0                # 无变化的指标数
    net_risk_delta: float = 0.0             # 风险评分变化（负=风险下降）
    verdict: str = ""                       # 综合结论一句话
    caveats: list[str] = field(default_factory=list)   # 不确定性说明

    @property
    def net_positive(self) -> bool:
        return self.improved_count > self.worsened_count

    def format_report(self) -> str:
        """多行可读报告，供 CLI 展示与 LLM prompt 引用"""
        lines = [f"情景：{self.scenario}"]
        if not self.executable:
            lines.append(f"该操作无法执行：{self.infeasible_reason}")
            return "\n".join(lines)
        for d in self.deltas:
            mark = "" if d.counted else "（参考）"
            lines.append(f"  · {d.format()}{mark}")
        lines.append(f"结论：{self.verdict}")
        if self.caveats:
            lines.append("说明：" + "；".join(self.caveats))
        return "\n".join(lines)


# ============================================================
#  硬风控闸门（fail-closed）
# ============================================================


@dataclass
class GateCheck:
    """单条闸门检查结果"""
    name: str               # 检查项名称
    passed: bool
    detail: str = ""        # 说明
    severity: str = "block"  # block（拦截）/ warn（仅提示）


@dataclass
class GateResult:
    """风控闸门结果——LLM 建议必须通过才能进入执行

    设计原则（参考 AstraQuant）：LLM proposes, Python disposes。
    任何检查项抛异常按 fail-closed 处理，一律拦截。
    """
    passed: bool
    checks: list[GateCheck] = field(default_factory=list)
    blocked_reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fail_closed: bool = False   # 是否因为异常而保守拦截

    @property
    def block_count(self) -> int:
        return sum(1 for c in self.checks if not c.passed and c.severity == "block")


# ============================================================
#  工具层结果封装
# ============================================================


@dataclass
class ToolResult:
    """工具执行结果的统一封装"""
    success: bool
    data: any = None
    error: str = ""
    source: str = ""     # 工具名称
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()


@dataclass
class MarketSnapshot:
    """某一时刻的市场快照——多个 MarketData 的聚合"""
    timestamp: str
    data: dict[str, MarketData] = field(default_factory=dict)  # symbol -> MarketData
    news: list[NewsItem] = field(default_factory=list)


# ============================================================
#  Context（放在最后避免循环引用）
# ============================================================


@dataclass
class Context:
    """Agent 运行时的完整上下文——所有模块共享，作为 LLM prompt 的输入"""
    user_profile: UserProfile
    portfolio: Portfolio
    market_snapshot: Optional[MarketSnapshot] = None
    recent_news: list[NewsItem] = field(default_factory=list)
    memory_summary: str = ""            # Memory 模块提供的历史摘要
    prev_recommendations: list[Recommendation] = field(default_factory=list)  # 最近建议（防重复）
    session_id: str = ""

    def has_market_data(self, symbol: str) -> bool:
        if not self.market_snapshot:
            return False
        return symbol in self.market_snapshot.data

    def get_price(self, symbol: str) -> Optional[float]:
        md = self.market_snapshot.data.get(symbol) if self.market_snapshot else None
        return md.price if md else None

    def build_llm_context(self) -> str:
        """把所有上下文拼成一段文字，供 LLM 参考"""
        lines = [
            f"## 用户画像",
            f"- 用户ID：{self.user_profile.user_id}",
            f"- 风险偏好：{self.user_profile.risk_tolerance.value}",
            f"- 投资期限：{self.user_profile.investment_horizon}",
            f"- 禁止行业：{', '.join(self.user_profile.forbidden_sectors) or '无'}",
            f"",
            f"## 当前组合（{self.portfolio.date}）",
            f"- 总市值：{self.portfolio.total_value:.2f} 元",
            f"- 现金：{self.portfolio.cash:.2f} 元",
            f"- 持仓数：{self.portfolio.position_count} 只",
        ]
        if self.portfolio.positions:
            lines.append("  持仓明细：")
            for p in self.portfolio.positions[:10]:
                lines.append(
                    f"  - {p.name}({p.symbol}): {p.quantity}股 "
                    f"成本价{p.avg_cost:.2f} 当前价{p.current_price:.2f} "
                    f"收益率{p.return_pct:+.2f}%"
                )
        if self.market_snapshot and self.market_snapshot.data:
            lines.append("")
            lines.append("## 市场行情")
            for sym, md in list(self.market_snapshot.data.items())[:5]:
                lines.append(
                    f"  - {md.name}({sym}): {md.price:.2f} "
                    f"涨跌幅 {md.change_pct:+.2f}%"
                )
        if self.recent_news:
            lines.append("")
            lines.append("## 最新新闻")
            for n in self.recent_news[:5]:
                lines.append(f"  - [{n.source}] {n.title}")
        if self.memory_summary:
            lines.append("")
            lines.append(f"## 历史记忆摘要")
            lines.append(f"  {self.memory_summary}")
        if self.prev_recommendations:
            lines.append("")
            lines.append("## 最近建议（避免重复）")
            for r in self.prev_recommendations[-3:]:
                lines.append(
                    f"  - {r.action.value} {r.symbol} {r.quantity}股: {r.reason}"
                )
        return "\n".join(lines)
