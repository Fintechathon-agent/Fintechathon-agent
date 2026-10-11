"""银行 AI 智能体 · 六场景数据契约（2026-10-11 新增）。

与 contracts/types.py 的关系：
  · types.py 是理财主链路既有契约，字段一律不动；
  · 本文件是转账/账单/订阅/卡片/跨场景联动五个新场景的数据结构，
    独立存放，待团队确认后再决定是否并入共享 Schema（遵守公共接口锁定原则）。

数据口径对齐（队长要求）：
  · 时间一律 ISO 字符串；金额一律元（float，展示时四舍五入到分）；
  · 每条数据带 as_of / source，来源不可追溯的记录不得进入执行链路；
  · 演示数据 source 标 "demo"，真实数据接入前不得谎称实时。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional


# ============================================================
#  权限分级（对齐赛题「权限分级机制」表，覆盖六场景操作）
# ============================================================

Tier = Literal["green", "yellow", "red", "blocked"]

TIER_POLICY = {
    "green": "确认意图后自动执行，无需二次确认",
    "yellow": "执行前展示操作详情并获得明确确认",
    "red": "须通过人脸识别、短信验证码或 U 盾等多因子认证",
    "blocked": "未通过确定性闸门，任何情况下不放行",
}


# ============================================================
#  账单（场景 2 账单分析）
# ============================================================


@dataclass
class BillRecord:
    """单笔账单流水（演示数据 source="demo"）"""
    tx_id: str
    ts: str                    # 交易时间 ISO
    merchant: str
    category: str              # 餐饮/交通/购物/娱乐/居住/医疗/教育/其他
    amount: float              # 元，负数=支出
    channel: str = "card"      # card / bank / subscription
    city: str = ""
    country: str = "CN"
    note: str = ""
    source: str = "demo"
    as_of: str = ""

    def __post_init__(self):
        if not self.as_of:
            self.as_of = datetime.now().strftime("%Y-%m-%d")


@dataclass
class BillAnomaly:
    """账单异常识别结果（规则确定性，可解释）"""
    rule: str                  # 规则名，如 large_amount / overseas / night / duplicate / new_merchant
    severity: str              # info / warning
    tx_id: str
    detail: str


@dataclass
class BillReport:
    """账单分析报告（绿权限，纯查询）"""
    period: str                # 2026-10 或 2026
    total_spend: float
    by_category: dict[str, float]
    anomalies: list[BillAnomaly]
    top_merchants: list[tuple[str, float]]
    insights: list[str]
    generated_at: str
    source: str = "demo"
    transaction_count: int = 0


# ============================================================
#  订阅 / 代扣（场景 5）
# ============================================================


@dataclass
class Subscription:
    """订阅/代扣识别结果"""
    sub_id: str
    merchant: str
    amount: float
    cadence: str               # monthly / yearly / weekly
    next_charge_at: str        # 下次扣费日期
    first_seen_at: str
    last_charge_at: str
    status: str = "active"     # active / cancelled
    evidence_tx_ids: list[str] = field(default_factory=list)   # 判定依据的交易ID
    source: str = "demo"

    def due_soon(self, horizon_days: int = 7) -> bool:
        """是否在未来 horizon_days 天内到期（续费提醒）"""
        try:
            d = datetime.fromisoformat(self.next_charge_at)
            now = datetime.now()
            days = (d - now).days
            return 0 <= days <= horizon_days
        except ValueError:
            return False


# ============================================================
#  转账（场景 1 智能转账）
# ============================================================


@dataclass
class Contact:
    """通讯录联系人（收款人校验的确定性依据）"""
    contact_id: str
    name: str
    phone: str = ""
    relation: str = ""


@dataclass
class TransferRequest:
    """一笔转账请求（槽位抽取结果）"""
    request_id: str
    payee: str                 # 收款人姓名或手机号（原始表述）
    amount: float              # 元
    memo: str = ""
    scheduled_at: str = ""     # 定时转账的预约时间（空=立即）
    aa_participants: list[str] = field(default_factory=list)  # AA 拆分人数或名单
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now().isoformat(timespec="seconds")


@dataclass
class TransferResult:
    """转账执行/待确认结果"""
    request: TransferRequest
    tier: Tier
    status: str                # executed / pending_confirmation / blocked / scheduled
    message: str
    gate_checks: list[dict] = field(default_factory=list)
    matched_contact: Optional[Contact] = None
    daily_cumulative: float = 0.0
    aa_items: list[dict] = field(default_factory=list)


# ============================================================
#  卡片管理（场景 4）
# ============================================================


@dataclass
class BankCard:
    """银行卡（演示数据）"""
    card_id: str
    last4: str
    card_type: str             # 信用卡 / 借记卡
    bank: str
    status: str = "normal"     # normal / locked / lost / expired
    credit_limit: float = 0.0        # 信用卡额度
    daily_txn_limit: float = 0.0     # 单日交易限额
    source: str = "demo"


@dataclass
class CardActionResult:
    card_id: str
    operation: str             # lock / unlock / limit_adjust / loss_report / query
    tier: Tier
    status: str                # executed / pending_confirmation / blocked
    message: str
    gate_checks: list[dict] = field(default_factory=list)


# ============================================================
#  跨场景联动（场景 6）
# ============================================================


@dataclass
class CrossScenePlan:
    """跨场景联动任务计划"""
    plan_id: str
    summary: str
    steps: list[dict] = field(default_factory=list)   # 有序子任务（含依赖与状态）
    memory_writes: list[dict] = field(default_factory=list)   # 写入记忆的内容
    scheduled: list[dict] = field(default_factory=list)       # 计划任务（含 mock 标注）
    pending_confirmations: list[dict] = field(default_factory=list)  # 需要用户确认的步骤
    caveats: list[str] = field(default_factory=list)


# ============================================================
#  统一场景结果（Web 层出口）
# ============================================================


@dataclass
class ScenarioResult:
    """六场景统一执行结果"""
    scenario: str              # wealth / transfer / bill / subscription / card / cross_scene
    scenario_label: str
    intent: dict               # 意图与槽位
    plan: dict                 # 场景任务 DAG
    tier: Tier
    status: str                # done / pending_confirmation / blocked / scheduled
    data: dict = field(default_factory=dict)
    message: str = ""
    approval_id: str = ""      # 黄色/红色操作进入审批队列后的 ID（跨场景复用审批管线）
    audit_actions: list[tuple[str, dict]] = field(default_factory=list)
