"""六场景演示数据（fixtures）与运行态管理。

数据全部 source="demo"，界面显著标注；运行态（卡片状态、订阅取消、
转账日累计、待确认队列）内存维护，重启回退到 fixture 并可从审计/日志重放。

口径：
  · 金额单位为元；时间 ISO；
  · 账单数据 as_of=2026-10-11，覆盖 2025-01 至今，保证「年/月」报告有数据；
  · 订阅识别依赖「同商户同金额跨 ≥3 个月」规则，fixtures 按此构造。
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from contracts.banking import BankCard, BillRecord, Contact, Subscription

STATE_DIR = Path(__file__).resolve().parent.parent / "data" / "banking"


def _months_ago(n: int, day: int = 10, hour: int = 12) -> str:
    now = datetime.now()
    y, m = now.year, now.month
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return datetime(y, m, day, hour, 30).isoformat(timespec="seconds")


def demo_contacts() -> list[Contact]:
    return [
        Contact(contact_id="c1", name="陈大黄", phone="13800001111", relation="朋友"),
        Contact(contact_id="c2", name="林粹", phone="13900002222", relation="队友"),
        Contact(contact_id="c3", name="邹昕成", phone="13700003333", relation="队长"),
        Contact(contact_id="c4", name="陆小果", phone="13600004444", relation="队友"),
    ]


def demo_cards() -> list[BankCard]:
    return [
        BankCard(card_id="card1", last4="8888", card_type="信用卡", bank="平安银行",
                 status="normal", credit_limit=50_000.0, daily_txn_limit=20_000.0),
        BankCard(card_id="card2", last4="6666", card_type="借记卡", bank="招商银行",
                 status="normal", credit_limit=0.0, daily_txn_limit=50_000.0),
        BankCard(card_id="card3", last4="1234", card_type="信用卡", bank="工商银行",
                 status="locked", credit_limit=30_000.0, daily_txn_limit=10_000.0),
    ]


def demo_bills() -> list[BillRecord]:
    """覆盖近 14 个月的账单流水：日常消费 + 三个可识别的订阅 + 若干异常样本。"""
    rows: list[BillRecord] = []
    tx = 0

    def add(months_ago: int, day: int, hour: int, merchant: str, category: str,
            amount: float, country: str = "CN", channel: str = "card", note: str = "") -> None:
        nonlocal tx
        tx += 1
        rows.append(BillRecord(
            tx_id=f"tx{tx:04d}", ts=_months_ago(months_ago, day, hour),
            merchant=merchant, category=category, amount=round(amount, 2),
            country=country, channel=channel, note=note,
        ))

    # 订阅样本：连续 12 个月，同商户同金额（识别为 monthly）
    for m in range(12, 0, -1):
        add(m, 1, 9, "超燃健身", "娱乐", 199.0, note="健身房月卡")
        add(m, 3, 10, "云音乐VIP", "娱乐", 15.0, note="音乐会员")
        add(m, 5, 8, "云盘Pro", "其他", 68.0, note="网盘年费" if m % 12 == 0 else "网盘月费")

    # 日常消费（本月）
    add(0, 3, 12, "陈记面馆", "餐饮", 32.0)
    add(0, 5, 19, "永辉超市", "居住", 156.80)
    add(0, 8, 13, "地铁出行", "交通", 45.0)
    add(0, 9, 21, "淘宝集市", "购物", 328.0)
    add(0, 12, 14, "滴滴出行", "交通", 23.5)
    add(0, 14, 19, "海底捞", "餐饮", 486.0)
    add(0, 16, 11, "国家电网", "居住", 210.0)
    add(0, 18, 20, "京东商城", "购物", 1299.0)
    # 异常样本：大额
    add(0, 6, 15, "名表专柜", "购物", 8600.0, note="大额样本")
    # 异常样本：境外
    add(0, 7, 9, "Amazon US", "购物", 238.5, country="US")
    # 异常样本：深夜
    add(0, 8, 2, "凌晨便利店", "餐饮", 88.0)
    # 异常样本：同日同金额重复扣款
    add(0, 10, 10, "视频会员", "娱乐", 25.0)
    add(0, 10, 10, "视频会员", "娱乐", 25.0)
    # 异常样本：新商户首次大额
    add(0, 11, 16, "新商户数码", "购物", 3200.0)

    # 历史月份填充（近 5 个月）
    for m in range(1, 6):
        add(m, 4, 12, "陈记面馆", "餐饮", 30.0 + m)
        add(m, 7, 19, "永辉超市", "居住", 120.0 + m * 7)
        add(m, 15, 13, "地铁出行", "交通", 40.0 + m)
        add(m, 20, 21, "淘宝集市", "购物", 200.0 + m * 13)
    # 去年数据（年报告用）
    for m in range(13, 17):
        add(m, 5, 12, "陈记面馆", "餐饮", 28.0)
        add(m, 9, 19, "永辉超市", "居住", 110.0)
    return rows


def demo_balance() -> float:
    return 25_680.50


# ============================================================
#  运行态（内存 + 落盘）
# ============================================================


class BankingState:
    """六场景运行态：卡片状态、已取消订阅、转账日累计、待确认队列。

    写操作落盘到 data/banking/state.json（该目录已在 .gitignore 的
    运行时产物清单内），重启后按文件重放，保持演示连续性。
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.cards = demo_cards()
        self.cancelled_subs: set[str] = set()
        self.transfer_day: str = datetime.now().strftime("%Y-%m-%d")
        self.daily_cumulative: float = 0.0
        self.pending: list[dict] = []
        self._load()

    def _path(self) -> Path:
        return STATE_DIR / "state.json"

    def _load(self) -> None:
        try:
            raw = json.loads(self._path().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        self.cancelled_subs = set(raw.get("cancelled_subs", []))
        for card_d in raw.get("cards", []):
            for c in self.cards:
                if c.card_id == card_d.get("card_id"):
                    c.status = card_d.get("status", c.status)
                    c.credit_limit = card_d.get("credit_limit", c.credit_limit)
                    c.daily_txn_limit = card_d.get("daily_txn_limit", c.daily_txn_limit)
        self.transfer_day = raw.get("transfer_day", self.transfer_day)
        if self.transfer_day == datetime.now().strftime("%Y-%m-%d"):
            self.daily_cumulative = float(raw.get("daily_cumulative", 0.0))
        self.pending = raw.get("pending", [])

    def save(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self._path().write_text(json.dumps({
            "cancelled_subs": sorted(self.cancelled_subs),
            "cards": [{
                "card_id": c.card_id, "status": c.status,
                "credit_limit": c.credit_limit, "daily_txn_limit": c.daily_txn_limit,
            } for c in self.cards],
            "transfer_day": self.transfer_day,
            "daily_cumulative": self.daily_cumulative,
            "pending": self.pending,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def reset(self) -> None:
        """重置演示状态：卡片/订阅回到 fixture，清空待办与当日累计。"""
        with self._lock:
            self.cards = demo_cards()
            self.cancelled_subs = set()
            self.transfer_day = datetime.now().strftime("%Y-%m-%d")
            self.daily_cumulative = 0.0
            self.pending = []
            self.save()

    # ---- 操作 ----

    def record_transfer(self, amount: float) -> None:
        with self._lock:
            today = datetime.now().strftime("%Y-%m-%d")
            if today != self.transfer_day:
                self.transfer_day = today
                self.daily_cumulative = 0.0
            self.daily_cumulative += amount
            self.save()

    def mark_subscription_cancelled(self, sub_id: str) -> None:
        with self._lock:
            self.cancelled_subs.add(sub_id)
            self.save()

    def apply_card_action(self, card_id: str, op: str, new_limit: Optional[float] = None) -> None:
        from agent.banking.cards import apply_card_action
        with self._lock:
            apply_card_action(self.cards, card_id, op, new_limit)
            self.save()

    def subscriptions(self, bills: list[BillRecord]) -> list[Subscription]:
        from agent.banking.subscriptions import detect_subscriptions
        subs = detect_subscriptions(bills)
        for s in subs:
            if s.sub_id in self.cancelled_subs:
                s.status = "cancelled"
        return subs


_state: Optional[BankingState] = None


def get_banking_state() -> BankingState:
    global _state
    if _state is None:
        _state = BankingState()
    return _state
