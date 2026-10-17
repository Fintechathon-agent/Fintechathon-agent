"""六场景演示数据（fixtures）与运行态管理。

数据全部 source="demo"，界面显著标注；运行态（卡片状态、订阅取消、
转账日累计、待确认队列与回执）以原子文件保存，重启恢复；文件损坏时停止加载。

口径：
  · 金额单位为元；时间 ISO；
  · 账单数据 as_of=2026-10-11，覆盖 2025-01 至今，保证「年/月」报告有数据；
  · 订阅识别依赖「同商户同金额跨 ≥3 个月」规则，fixtures 按此构造。
"""
from __future__ import annotations

import json
import math
import threading
from contextlib import contextmanager
from copy import deepcopy
from agent.core.storage import atomic_write_json
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
        Contact(contact_id="c1", name="王芳", phone="13800001111", relation="家人"),
        Contact(contact_id="c2", name="李明", phone="13900002222", relation="同事"),
        Contact(contact_id="c3", name="张伟", phone="13700003333", relation="朋友"),
        Contact(contact_id="c4", name="刘洋", phone="13600004444", relation="同学"),
        Contact(contact_id="c5", name="陈静", phone="13500005555", relation="朋友"),
        Contact(contact_id="c6", name="周涛", phone="13400006666", relation="同事"),
        Contact(contact_id="c7", name="吴霞", phone="13300007777", relation="家人"),
    ]


def demo_cards() -> list[BankCard]:
    return [
        BankCard(card_id="card1", last4="8888", card_type="信用卡", bank="平安银行",
                 status="normal", credit_limit=50_000.0, daily_txn_limit=20_000.0),
        BankCard(card_id="card2", last4="6666", card_type="借记卡", bank="招商银行",
                 status="normal", credit_limit=0.0, daily_txn_limit=50_000.0),
        BankCard(card_id="card3", last4="1234", card_type="信用卡", bank="工商银行",
                 status="locked", credit_limit=30_000.0, daily_txn_limit=10_000.0),
        BankCard(card_id="card4", last4="5555", card_type="借记卡", bank="建设银行",
                 status="normal", credit_limit=0.0, daily_txn_limit=20_000.0),
        BankCard(card_id="card5", last4="0000", card_type="信用卡", bank="交通银行",
                 status="normal", credit_limit=80_000.0, daily_txn_limit=30_000.0),
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
        add(m, 6, 9, "咖啡月卡", "餐饮", 88.0, note="精品咖啡会员")
        add(m, 8, 11, "杂志订阅", "阅读", 30.0, note="电子杂志月订")

    # 日常消费（本月）
    add(0, 3, 12, "陈记面馆", "餐饮", 32.0)
    add(0, 5, 19, "永辉超市", "居住", 156.80)
    add(0, 8, 13, "地铁出行", "交通", 45.0)
    add(0, 9, 21, "淘宝集市", "购物", 328.0)
    add(0, 12, 14, "滴滴出行", "交通", 23.5)
    add(0, 14, 19, "海底捞", "餐饮", 486.0)
    add(0, 16, 11, "国家电网", "居住", 210.0)
    add(0, 18, 20, "京东商城", "购物", 1299.0)
    # 本月补充：更多分类与真实感流水
    add(0, 2, 8, "星巴克咖啡", "餐饮", 36.0)
    add(0, 4, 12, "美团外卖", "餐饮", 52.6)
    add(0, 6, 10, "药房购药", "医疗", 96.5)
    add(0, 7, 15, "高铁出行", "交通", 289.0)
    add(0, 9, 9, "话费充值", "通讯", 100.0)
    add(0, 10, 13, "优衣库门店", "购物", 399.0)
    add(0, 11, 18, "燃气缴费", "居住", 87.3)
    add(0, 13, 12, "在线课程", "教育", 199.0)
    add(0, 14, 20, "山姆会员店", "购物", 458.5)
    add(0, 15, 16, "体检中心", "医疗", 480.0)
    add(0, 17, 11, "宽带续费", "居住", 129.0)
    add(0, 18, 21, "电影院", "娱乐", 98.0)
    add(0, 19, 12, "书店购书", "教育", 78.0)
    add(0, 20, 13, "加油站", "交通", 300.0)
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
    """One atomic document holds balance, actions, receipts and scheduled requests."""

    def __init__(self):
        self._lock = threading.RLock()
        self._transaction_depth = 0
        self._restore({})
        self._load()

    def _path(self) -> Path:
        return STATE_DIR / "state.json"

    def _restore(self, raw: dict) -> None:
        self.cards = demo_cards()
        for saved in raw.get("cards", []):
            for card in self.cards:
                if card.card_id == saved.get("card_id"):
                    card.status = saved.get("status", card.status)
                    card.credit_limit = saved.get("credit_limit", card.credit_limit)
                    card.daily_txn_limit = saved.get("daily_txn_limit", card.daily_txn_limit)
        self.cancelled_subs = set(raw.get("cancelled_subs", []))
        self.transfer_day = raw.get("transfer_day", datetime.now().strftime("%Y-%m-%d"))
        self.daily_cumulative = float(raw.get("daily_cumulative", 0))
        self.balance = float(raw.get("balance", max(0, demo_balance() - self.daily_cumulative)))
        if not all(math.isfinite(v) and v >= 0 for v in (self.balance, self.daily_cumulative)):
            raise ValueError("银行账本数值无效，须人工核实")
        self.pending = deepcopy(raw.get("pending", []))
        self.scheduled = deepcopy(raw.get("scheduled", []))
        self.receipts = deepcopy(raw.get("receipts", {}))
        self.collections = deepcopy(raw.get("collections", []))
        self.audit_outbox = deepcopy(raw.get("audit_outbox", []))
        self.demo_seeded = bool(raw.get("demo_seeded", False))

    def _dump(self) -> dict:
        return {
            "schema_version": 2,
            "cards": [{"card_id": c.card_id, "status": c.status, "credit_limit": c.credit_limit,
                       "daily_txn_limit": c.daily_txn_limit} for c in self.cards],
            "cancelled_subs": sorted(self.cancelled_subs), "transfer_day": self.transfer_day,
            "daily_cumulative": self.daily_cumulative, "balance": self.balance,
            "pending": self.pending, "scheduled": self.scheduled, "receipts": self.receipts,
            "collections": self.collections, "demo_seeded": self.demo_seeded,
            "audit_outbox": self.audit_outbox,
        }

    def _load(self) -> None:
        try:
            raw = json.loads(self._path().read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        # Damaged state must fail closed instead of restoring spendable fixture money.
        self._restore(raw)
        self.refresh_day()

    def refresh_day(self) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        if today != self.transfer_day:
            self.transfer_day = today
            self.daily_cumulative = 0.0

    @contextmanager
    def transaction(self):
        with self._lock:
            outer = self._transaction_depth == 0
            snapshot = deepcopy(self._dump()) if outer else None
            self._transaction_depth += 1
            try:
                self.refresh_day()
                yield self
                if outer:
                    current = self._dump()
                    if current != snapshot:
                        atomic_write_json(self._path(), current)
            except BaseException:
                if outer:
                    self._restore(snapshot)
                raise
            finally:
                self._transaction_depth -= 1

    def save(self) -> None:
        with self._lock:
            if not self._transaction_depth:
                atomic_write_json(self._path(), self._dump())

    def reset(self) -> None:
        with self.transaction():
            self._restore({"demo_seeded": True})

    def record_transfer(self, amount: float) -> None:
        with self.transaction():
            if not (0 < amount <= self.balance):
                raise ValueError("可用余额不足或金额无效")
            self.balance = round(self.balance - amount, 2)
            self.daily_cumulative = round(self.daily_cumulative + amount, 2)

    def mark_subscription_cancelled(self, sub_id: str) -> None:
        with self.transaction():
            if sub_id in self.cancelled_subs:
                raise ValueError("该订阅已取消")
            self.cancelled_subs.add(sub_id)

    def apply_card_action(self, card_id: str, op: str, new_limit: Optional[float] = None) -> None:
        from agent.banking.cards import apply_card_action
        with self.transaction():
            if apply_card_action(self.cards, card_id, op, new_limit) is None:
                raise ValueError("卡片不存在")

    def subscriptions(self, bills: list[BillRecord]) -> list[Subscription]:
        from agent.banking.subscriptions import detect_subscriptions
        subs = detect_subscriptions(bills)
        for sub in subs:
            if sub.sub_id in self.cancelled_subs:
                sub.status = "cancelled"
        return subs


_state: Optional[BankingState] = None


def get_banking_state() -> BankingState:
    global _state
    if _state is None:
        _state = BankingState()
    return _state
