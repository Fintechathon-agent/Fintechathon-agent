# -*- coding: utf-8 -*-
"""把采集成品回填进私有数据库（幂等，可反复运行）。

数据流：out/market_*.json、out/fund_*.json、dataset/briefs_21d.jsonl、
成稿 brief_*.md + group_*.txt → brief/db/market.db（本机私有，不入库）。

用法：
    python brief/ingest_to_db.py --all              # 回填全部历史
    python brief/ingest_to_db.py --date 2026-10-12  # 只回填某一天（定时任务每日调用）
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

import db as market_db  # brief/db.py（同目录导入）

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
DATASET = HERE / "dataset" / "briefs_21d.jsonl"

# 行情代码表：与 collect_market_data.py 同源（导入失败时退化为空表）
try:
    from collect_market_data import (A_SHARE, HK_CODES, US_CODES, COMMODITY,
                                     FX_CODES, UNIVERSE)
except ImportError:  # pragma: no cover - 结构防御
    A_SHARE = HK_CODES = US_CODES = COMMODITY = FX_CODES = UNIVERSE = {}


def _code_map() -> dict[str, dict[str, str]]:
    return {
        "a_share": A_SHARE,
        "hk": HK_CODES,
        "us": US_CODES,
        "commodity": COMMODITY,
        "fx": FX_CODES,
        "universe": UNIVERSE,
    }


def _rev(d: dict[str, str]) -> dict[str, str]:
    return {v: k for k, v in d.items()}


def ingest_market(conn, path: Path) -> int:
    """market_YYYY-MM-DD.json → quotes / rates / news / earnings。返回写入行数。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    date = data.get("date") or path.stem.replace("market_", "")
    codes = _code_map()
    rev = {m: _rev(mp) for m, mp in codes.items()}
    n = 0
    markets = data.get("markets") or {}
    for group, rows in markets.items():
        for r in rows:
            code = r.get("code") or rev.get(group, {}).get(r.get("name"), r.get("name"))
            market_db.upsert_quote(
                conn, date, group, code, r.get("name", ""), r.get("last"),
                r.get("change"), r.get("change_pct"), r.get("date", ""),
                r.get("time", ""))
            n += 1
    rates = data.get("rates") or {}
    official = rates.get("official")
    if official:
        for series, key in (("us10y", "us10y"), ("us30y", "us30y")):
            if official.get(key) is not None:
                market_db.upsert_rate(conn, official.get("date", date), series,
                                      official[key], date, "treasury_official")
                n += 1
    for series in ("us10y", "us30y"):
        fred = rates.get(series)
        if fred and fred.get("value") is not None:
            market_db.upsert_rate(conn, fred.get("date", date), series,
                                  fred["value"], date, "fred")
            n += 1
    for item in data.get("news") or []:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        cats = item.get("category") or []
        market_db.upsert_news(conn, date, item.get("time", ""), title,
                              ",".join(cats) if cats else "other",
                              item.get("url", ""))
        n += 1
    ef = data.get("earnings_forecast")
    if ef:
        market_db.upsert_earnings(conn, date, ef.get("report_date", date), ef)
        n += 1
    return n


def ingest_fund(conn, path: Path) -> int:
    """fund_YYYY-MM-DD.json → fund_nav（旗舰池历史净值）。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for fund in data.get("universe") or []:
        code, name, ftype = fund.get("code"), fund.get("name", ""), fund.get("type", "")
        for row in fund.get("rows") or []:
            market_db.upsert_fund_nav(conn, code, row.get("date", ""), name, ftype,
                                      row.get("nav"), row.get("acc_nav"),
                                      row.get("change_pct"))
            n += 1
    return n


def ingest_fund_all(conn, path: Path) -> int:
    """fund_all_YYYY-MM-DD.json → fund_all（全市场每日快照）。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    date = data.get("date") or path.stem.replace("fund_all_", "")
    n = 0
    for row in data.get("rows") or []:
        market_db.upsert_fund_all(conn, row.get("code"), date, row.get("name", ""),
                                  row.get("nav"), row.get("acc_nav"),
                                  row.get("change_pct"))
        n += 1
    return n


def ingest_dataset(conn, path: Path = DATASET) -> int:
    """briefs_21d.jsonl → brief_events（事件→解释→风险→决策）。"""
    if not path.exists():
        return 0
    n = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not rec.get("id"):
            continue
        market_db.upsert_brief_event(conn, rec)
        n += 1
    return n


def ingest_briefs(conn) -> int:
    """成稿 brief_*.md + group_*.txt → briefs 留档。"""
    n = 0
    for md in sorted(OUT_DIR.glob("brief_????-??-??.md")):
        date = md.stem.replace("brief_", "")
        group = OUT_DIR / f"group_{date}.txt"
        title = f"Daily Market Brief {date}"
        market_db.upsert_brief(
            conn, date, title,
            group.read_text(encoding="utf-8") if group.exists() else "",
            md.read_text(encoding="utf-8"),
            datetime.fromtimestamp(md.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        )
        n += 1
    return n


def ingest_day(conn, date: str) -> dict:
    """回填指定日期，返回各来源写入行数。"""
    stats = {"market": 0, "fund": 0, "fund_all": 0}
    market = OUT_DIR / f"market_{date}.json"
    fund = OUT_DIR / f"fund_{date}.json"
    fund_all = OUT_DIR / f"fund_all_{date}.json"
    if market.exists():
        stats["market"] = ingest_market(conn, market)
    if fund.exists():
        stats["fund"] = ingest_fund(conn, fund)
    if fund_all.exists():
        stats["fund_all"] = ingest_fund_all(conn, fund_all)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="私有市场数据库回填（幂等）")
    parser.add_argument("--all", action="store_true", help="回填全部历史")
    parser.add_argument("--date", default="", help="只回填指定日期 YYYY-MM-DD")
    args = parser.parse_args()

    conn = market_db.connect()
    try:
        if args.date:
            dates = [args.date]
        else:
            dates = sorted(
                p.stem.replace("market_", "")
                for p in OUT_DIR.glob("market_????-??-??.json")
                if re.match(r"market_\d{4}-\d{2}-\d{2}\.json", p.name)
            )
        for d in dates:
            stats = ingest_day(conn, d)
            print(f"[{d}] market +{stats['market']}  fund +{stats['fund']}"
                  f"  fund_all +{stats['fund_all']}")
        ev = ingest_dataset(conn)
        br = ingest_briefs(conn)
        print(f"[dataset] brief_events +{ev}  [briefs] +{br}")
        market_db.touch_ingest(conn, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        conn.commit()
        print("== 各表行数 ==")
        for t, c in market_db.table_counts(conn).items():
            print(f"  {t:14s} {c}")
        print(f"库文件：{market_db.DB_PATH}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
