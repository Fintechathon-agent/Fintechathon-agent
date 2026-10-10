# -*- coding: utf-8 -*-
"""日报数据契约自检。

校验 `brief/out/market_*.json` 是否满足《数据契约》（审计报告 §3/§10）：
必备字段、时间语义、来源可追溯性。用于在 Memory 导入或发布前发现退化的数据。

用法：
    python brief/verify_contract.py                    # 校验最新一期
    python brief/verify_contract.py --date 2026-10-08
    python brief/verify_contract.py --all              # 校验全部历史（回归用）

退出码：0 = 全部通过；1 = 有 FAIL（数据不可用于下游）；0 但打印 WARN = 可用需关注。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# ISO 8601 带时区：2026-10-08T18:00:26.123456+08:00
ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$")

REQUIRED_TOP = ["date", "markets", "rates", "news"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Result:
    def __init__(self, name: str):
        self.name = name
        self.fails: list[str] = []
        self.warns: list[str] = []

    def fail(self, msg: str) -> None:
        self.fails.append(msg)

    def warn(self, msg: str) -> None:
        self.warns.append(msg)

    @property
    def ok(self) -> bool:
        return not self.fails


def verify_file(p: Path, require_v2: bool = True) -> Result:
    """require_v2=True 时把 schema_version/observed_at 视为硬要求
    （2026-10-08 起采集的产物应具备；更早的存档会 FAIL，用 --all 时以 WARN 处理）。"""
    r = Result(p.name)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        r.fail(f"无法解析 JSON：{e}")
        return r

    # ---- 1. 必备顶层字段 ----
    for k in REQUIRED_TOP:
        if k not in data:
            r.fail(f"缺少顶层字段 `{k}`")

    # ---- 2. 数据日期 ----
    d = data.get("date", "")
    if not DATE_RE.match(str(d)):
        r.fail(f"`date` 格式非法：{d!r}（应为 YYYY-MM-DD）")
    if p.stem != f"market_{d}":
        r.warn(f"文件名与 `date` 不一致：文件 {p.name} vs date {d}")

    # ---- 3. 时间语义（契约 §4.2）----
    obs = data.get("observed_at")
    if obs is None:
        r.fail("缺少 `observed_at`（采集时刻，ISO 8601 带时区）")
    elif not ISO_TZ.match(str(obs)):
        r.fail(f"`observed_at` 未带时区或格式非法：{obs!r}")
    gen = data.get("generated_at")
    if gen and ISO_TZ.match(str(gen)):
        r.warn("`generated_at` 已升级为 ISO 格式，确认下游展示未被破坏")

    # ---- 4. 来源可追溯（契约 §4.3）----
    rates = data.get("rates") or {}
    off = rates.get("official")
    if off:
        if not off.get("source"):
            r.fail("rates.official 缺 `source`（一手来源必须可追溯）")
        if not DATE_RE.match(str(off.get("date", ""))):
            r.fail(f"rates.official.date 格式非法：{off.get('date')!r}")
    else:
        r.warn("rates.official 缺失（美债一手源未采集）")

    ef = data.get("earnings_forecast")
    if ef and not ef.get("source"):
        r.fail("earnings_forecast 缺 `source`")

    # ---- 5. 行情条目自洽 ----
    for group, rows in (data.get("markets") or {}).items():
        for i, row in enumerate(rows or []):
            name = row.get("name", f"[{group}#{i}]")
            if row.get("last") is None:
                r.warn(f"{name}：`last` 为空")
            for tf in ("date", "time"):
                if tf in row and row[tf] and not str(row[tf]).strip():
                    r.warn(f"{name}：`{tf}` 为空串")
            if row.get("date") and not DATE_RE.match(str(row["date"])):
                r.fail(f"{name}：`date` 格式非法 {row['date']!r}")

    # ---- 6. schema 版本 ----
    if require_v2 and "schema_version" not in data:
        r.fail("缺少 `schema_version`（契约版本号）")

    return r


def main() -> None:
    ap = argparse.ArgumentParser(description="校验日报数据契约")
    ap.add_argument("--date", help="校验指定日期")
    ap.add_argument("--all", action="store_true", help="校验 out/ 下全部 market_*.json")
    args = ap.parse_args()

    if args.all:
        files = sorted(OUT_DIR.glob("market_*.json"))
        # 历史存档（契约升级前）缺新字段属预期，降级为 WARN
        strict_since = "2026-10-08"
        targets = [(f, f.stem.replace("market_", "") >= strict_since) for f in files]
    elif args.date:
        targets = [(OUT_DIR / f"market_{args.date}.json", True)]
    else:
        files = sorted(OUT_DIR.glob("market_*.json"))
        if not files:
            print("out/ 下没有 market_*.json")
            sys.exit(1)
        targets = [(files[-1], True)]

    any_fail = False
    for f, strict in targets:
        if not f.exists():
            print(f"[FAIL] {f.name}：文件不存在")
            any_fail = True
            continue
        res = verify_file(f, require_v2=strict)
        if not strict:
            res.warns.extend(res.fails)
            res.fails = []
        status = "PASS" if res.ok else "FAIL"
        print(f"[{status}] {f.name}" + ("" if strict else "  (契约升级前存档，宽松校验)"))
        for m in res.fails:
            print(f"   ✗ {m}")
        for m in res.warns:
            print(f"   ⚠ {m}")
        if not res.ok:
            any_fail = True

    print()
    if any_fail:
        print("结论：存在不符合契约的数据，下游（Memory 导入/发布）应阻断或人工确认。")
        sys.exit(1)
    print("结论：全部通过。")


if __name__ == "__main__":
    main()
