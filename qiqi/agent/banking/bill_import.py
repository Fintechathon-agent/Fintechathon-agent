"""Parse a small UTF-8 CSV/TXT statement for one explicitly bound bill task."""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from contracts.banking import BillRecord

MAX_FILE_BYTES = 256 * 1024
MAX_ROWS = 2000
AMOUNT = ("交易金额", "消费金额", "付款金额", "支出金额", "金额", "支出", "amount", "expense")
DIRECTION = ("收支方向", "收支类型", "交易类型", "方向", "direction", "type")
DATE = ("交易时间", "账单时间", "交易日期", "日期", "时间", "date", "time")
MERCHANT = ("商户", "交易对方", "对方户名", "交易描述", "商品", "名称", "merchant", "description")
CATEGORY = ("交易分类", "消费分类", "分类", "category")


def _column(headers: list[str], aliases: tuple[str, ...]) -> int | None:
    for alias in aliases:
        for index, header in enumerate(headers):
            if header == alias:
                return index
    return None


def _cents(value: str) -> int:
    raw = value.strip().replace(",", "").replace("¥", "").replace("￥", "").replace("元", "")
    try:
        number = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError("账单金额不是有效数字") from exc
    if not number.is_finite() or number == 0 or number.as_tuple().exponent < -2:
        raise ValueError("账单金额须为非零人民币金额，最多两位小数")
    cents = number * 100
    if abs(cents) > 10**12:
        raise ValueError("账单金额超出支持范围")
    return int(cents)


def parse_statement(name: str, content: str) -> tuple[list[BillRecord], dict]:
    """Positive BillRecord.amount means expense; negative means refund.

    A signed negative amount with no direction denotes expense. An explicit
    direction wins over sign. Income is excluded from expenditure totals.
    Duplicate rows remain visible and can be flagged by anomaly rules.
    """
    if not isinstance(name, str) or Path(name).suffix.lower() not in (".csv", ".txt"):
        raise ValueError("只支持 UTF-8 CSV/TXT 账单")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("账单文件为空")
    try:
        encoded = content.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("账单不是有效 UTF-8 文本") from exc
    if len(encoded) > MAX_FILE_BYTES:
        raise ValueError("账单超过 256 KiB，请拆分后重新上传")
    try:
        first_line = content.lstrip("\ufeff").splitlines()[0]
        delimiter = "\t" if "\t" in first_line and "," not in first_line else ","
        reader = csv.reader(io.StringIO(content.lstrip("\ufeff"), newline=""), delimiter=delimiter, strict=True)
        rows = [row for row in reader if any(cell.strip() for cell in row)]
    except csv.Error as exc:
        raise ValueError("CSV 引号或列结构无效") from exc
    if not rows:
        raise ValueError("账单文件没有表头")
    if len(rows) - 1 > MAX_ROWS:
        raise ValueError(f"账单超过 {MAX_ROWS} 行；未进行截断分析")
    headers = [cell.strip().lower().replace(" ", "") for cell in rows[0]]
    ai, di, ti, mi, ci = (_column(headers, aliases) for aliases in (AMOUNT, DIRECTION, DATE, MERCHANT, CATEGORY))
    if ai is None or ti is None:
        raise ValueError("账单须包含金额和日期列")
    batch_id = hashlib.sha256(encoded).hexdigest()[:24]
    records: list[BillRecord] = []
    for line, row in enumerate(rows[1:], start=2):
        if len(row) != len(headers):
            raise ValueError(f"第 {line} 行列数与表头不符")
        cents = _cents(row[ai])
        direction = row[di].strip().lower() if di is not None else ""
        if any(word in direction for word in ("退款", "退货", "refund")):
            amount = -abs(cents)
        elif any(word in direction for word in ("收入", "收款", "income", "credit")):
            amount = 0
        elif any(word in direction for word in ("支出", "付款", "消费", "expense", "debit")):
            amount = abs(cents)
        elif direction:
            raise ValueError(f"第 {line} 行收支方向无法识别")
        else:
            amount = abs(cents)
        timestamp = row[ti].strip().replace("/", "-")
        try:
            parsed = datetime.fromisoformat(timestamp)
        except ValueError as exc:
            raise ValueError(f"第 {line} 行日期无效") from exc
        merchant = row[mi].strip() if mi is not None else "未填写商户"
        category = row[ci].strip() if ci is not None else "未分类"
        records.append(BillRecord(
            tx_id=f"{batch_id}-{line}", ts=parsed.isoformat(timespec="seconds"),
            merchant=merchant or "未填写商户", category=category or "未分类",
            amount=amount / 100, source="uploaded_file", note="",
        ))
    if not records:
        raise ValueError("账单没有可分析的流水")
    return records, {"kind": "uploaded_file", "batch_id": batch_id,
                     "filename": Path(name).name, "row_count": len(records),
                     "amount_convention": "支出为正，退款抵减，收入不计支出；重复行保留并标记"}
