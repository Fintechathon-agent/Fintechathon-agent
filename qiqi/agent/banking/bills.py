"""账单分析（场景 2，绿权限纯查询）。

异常识别全部为确定性规则，可解释、可审计：
  · large_amount   单笔 ≥ 5000 元（演示口径）
  · overseas       境外商户
  · night          深夜消费（00:00–05:00）
  · duplicate      同商户同金额同日多次
  · new_merchant   首次出现商户且单笔 ≥ 1000 元
报告统计不生成任何预测数字。
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal

from contracts.banking import BillAnomaly, BillRecord, BillReport


def detect_anomalies(records: list[BillRecord]) -> list[BillAnomaly]:
    anomalies: list[BillAnomaly] = []

    by_merchant: dict[str, list[BillRecord]] = defaultdict(list)
    for r in records:
        if r.amount <= 0:
            continue
        by_merchant[r.merchant].append(r)

    for r in records:
        if r.amount <= 0:
            continue
        if r.amount >= 5000:
            anomalies.append(BillAnomaly(
                rule="large_amount", severity="warning", tx_id=r.tx_id,
                detail=f"{r.merchant} 单笔支出 {r.amount:,.0f} 元（≥5000），请确认是否为本人消费",
            ))
        if r.country and r.country != "CN":
            anomalies.append(BillAnomaly(
                rule="overseas", severity="info", tx_id=r.tx_id,
                detail=f"{r.merchant}（{r.country}）境外商户交易",
            ))
        try:
            hour = datetime.fromisoformat(r.ts).hour
        except ValueError:
            hour = -1
        if 0 <= hour < 5:
            anomalies.append(BillAnomaly(
                rule="night", severity="info", tx_id=r.tx_id,
                detail=f"{r.merchant} 凌晨 {hour:02d}:00 消费，若非常规作息请留意",
            ))

    for merchant, rows in by_merchant.items():
        # 同日同金额重复扣款
        seen: dict[tuple[str, float], int] = Counter(
            (r.ts[:10], r.amount) for r in rows if r.amount > 0
        )
        for (day, amount), count in seen.items():
            if count >= 2:
                anomalies.append(BillAnomaly(
                    rule="duplicate", severity="warning", tx_id=rows[0].tx_id,
                    detail=f"{merchant} 在 {day} 出现 {count} 笔相同金额 {amount:,.2f} 元的扣款，疑似重复扣费",
                ))
        # 首次出现商户且大额
        first = min(rows, key=lambda r: r.ts)
        if first.amount >= 1000 and len(rows) == 1:
            anomalies.append(BillAnomaly(
                rule="new_merchant", severity="info", tx_id=first.tx_id,
                detail=f"首次出现在账单中的商户 {merchant} 单笔 {first.amount:,.0f} 元，请确认交易真实性",
            ))
    return anomalies


def analyze_period(records: list[BillRecord], period: str) -> BillReport:
    """按周期聚合；上传文件可明确使用“上传文件全部记录”。"""
    if period == "上传文件全部记录":
        rows = list(records)
    elif len(period) == 7:       # 月
        rows = [r for r in records if r.ts[:7] == period]
    else:                      # 年
        rows = [r for r in records if r.ts[:4] == period]

    def minor(record: BillRecord) -> int:
        cents = Decimal(str(record.amount)) * 100
        if not cents.is_finite() or cents != cents.to_integral_value():
            raise ValueError("账单金额须精确到分")
        return int(cents)

    spend_rows = [r for r in rows if r.amount > 0]
    refund_rows = [r for r in rows if r.amount < 0]
    included = spend_rows + refund_rows
    total_minor = sum(minor(r) for r in included)
    total = total_minor / 100
    by_category_minor: dict[str, int] = defaultdict(int)
    top_minor: dict[str, int] = defaultdict(int)
    for r in included:
        by_category_minor[r.category] += minor(r)
        top_minor[r.merchant] += minor(r)
    by_category = {key: value / 100 for key, value in by_category_minor.items()}
    top_merchants = [(key, value / 100) for key, value in sorted(top_minor.items(), key=lambda item: item[1], reverse=True)[:5]]

    insights: list[str] = []
    if by_category:
        biggest_cat, biggest_val = max(by_category.items(), key=lambda kv: kv[1])
        pct = biggest_val / total * 100 if total else 0
        insights.append(f"{period} 最大支出类别为「{biggest_cat}」共 {biggest_val:,.0f} 元（{pct:.0f}%）")
    if refund_rows:
        insights.append(f"{len(refund_rows)} 笔退款已抵减同期间支出；收入不计入支出，重复扣款保留并标记")
    anomalies = detect_anomalies(rows)
    if anomalies:
        warns = [a for a in anomalies if a.severity == "warning"]
        if warns:
            insights.append(f"发现 {len(warns)} 条需人工核实的交易，详见异常清单")
    if not rows:
        insights.append(f"{period} 无账单记录")
    return BillReport(
        period=period,
        total_spend=total,
        by_category=dict(sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)),
        anomalies=anomalies,
        top_merchants=top_merchants,
        insights=insights,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        transaction_count=len(spend_rows),
    )


def parse_bill_period(text: str) -> str:
    """从自然语言提取账单周期：本/这个月 → 当前月；去年/今年 → 年；数字年/月。"""
    now = datetime.now()
    if re.search(r"(上个月|上月)", text):
        month = now.month - 1 or 12
        year = now.year if now.month > 1 else now.year - 1
        return f"{year}-{month:02d}"
    if re.search(r"(这个月|本月|这个月|当月)", text):
        return now.strftime("%Y-%m")
    m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{4})\s*年", text)
    if m:
        return m.group(1)
    if re.search(r"(去年)", text):
        return str(now.year - 1)
    return now.strftime("%Y-%m")
