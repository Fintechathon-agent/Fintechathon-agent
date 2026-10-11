"""订阅 / 代扣管理（场景 5）。

识别规则（确定性）：
  同一商户、同一金额、在 ≥3 个不同月份出现 → 判定为订阅，扣费周期按
  相邻月份间隔推断（1 个月 → monthly；12 个月 → yearly；≤7 天 → weekly）。
取消订阅为黄色权限：展示详情 → 用户确认 → 状态置 cancelled（不篡改历史账单）。
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta

from contracts.banking import BillRecord, Subscription


def detect_subscriptions(records: list[BillRecord]) -> list[Subscription]:
    """从账单流水中识别周期性扣费。"""
    by_key: dict[tuple[str, float], list[BillRecord]] = defaultdict(list)
    for r in records:
        if r.amount > 0:
            by_key[(r.merchant, round(r.amount, 2))].append(r)

    subs: list[Subscription] = []
    for (merchant, amount), rows in by_key.items():
        if len(rows) < 3:
            continue
        rows_sorted = sorted(rows, key=lambda r: r.ts)
        months = {r.ts[:7] for r in rows_sorted}
        if len(months) < 3:
            continue    # 同月多次不算订阅

        # 周期推断：看相邻两笔的间隔
        gaps = []
        for a, b in zip(rows_sorted, rows_sorted[1:]):
            try:
                gaps.append((datetime.fromisoformat(b.ts) - datetime.fromisoformat(a.ts)).days)
            except ValueError:
                continue
        if not gaps:
            continue
        avg_gap = sum(gaps) / len(gaps)
        if avg_gap <= 7:
            cadence = "weekly"
        elif avg_gap <= 45:
            cadence = "monthly"
        elif avg_gap <= 400:
            cadence = "yearly"
        else:
            cadence = "monthly"

        last = rows_sorted[-1]
        try:
            last_dt = datetime.fromisoformat(last.ts)
            if cadence == "weekly":
                next_dt = last_dt + timedelta(days=7)
            elif cadence == "yearly":
                next_dt = last_dt.replace(year=last_dt.year + 1)
            else:
                next_dt = last_dt.replace(
                    year=last_dt.year + (1 if last_dt.month == 12 else 0),
                    month=1 if last_dt.month == 12 else last_dt.month + 1,
                )
            next_charge = next_dt.strftime("%Y-%m-%d")
        except ValueError:
            next_charge = ""

        subs.append(Subscription(
            sub_id=f"sub_{merchant}_{amount:.0f}",
            merchant=merchant,
            amount=amount,
            cadence=cadence,
            next_charge_at=next_charge,
            first_seen_at=rows_sorted[0].ts,
            last_charge_at=last.ts,
            evidence_tx_ids=[r.tx_id for r in rows_sorted],
        ))
    return sorted(subs, key=lambda s: s.next_charge_at or "9999")


def find_subscription(subs: list[Subscription], text: str) -> Subscription | None:
    """按商户名匹配订阅（商户名或其任意 2 字以上子串出现在文本中）。

    子串匹配解决口语化表达：商户「超燃健身」可被「健身房会员」命中。
    """
    text_norm = text.lower()
    for s in subs:
        if s.merchant in text or s.merchant.lower() in text_norm:
            return s
    for s in subs:
        name = s.merchant
        for size in range(len(name), 1, -1):
            for start in range(0, len(name) - size + 1):
                seg = name[start:start + size]
                if seg.lower() in text_norm:
                    return s
    return None


def renewal_reminders(subs: list[Subscription], horizon_days: int = 7) -> list[Subscription]:
    return [s for s in subs if s.status == "active" and s.due_soon(horizon_days)]
