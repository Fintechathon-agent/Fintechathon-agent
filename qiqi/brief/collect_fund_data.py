# -*- coding: utf-8 -*-
"""旗舰基金数据采集——为「理财旗舰」与私有数据库提供公募基金净值。

数据源（2026-10-12 实测可用）：
- 东财 F10 净值 API  api.fund.eastmoney.com/f10/lsjz（单只历史净值，需 Referer）
- akshare fund_open_fund_daily_em（全市场每日净值快照，可选，失败自动跳过）

用法：
    python brief/collect_fund_data.py                    # 采集今天
    python brief/collect_fund_data.py --date 2026-10-12  # 指定日期（仅影响输出文件名）
    python brief/collect_fund_data.py --no-full-market   # 跳过全市场快照（更快）

输出：
    out/fund_YYYY-MM-DD.json      旗舰基金池历史净值（结构化，随日报入私有库）
    out/fund_all_YYYY-MM-DD.json  全市场基金每日净值快照（约 2.4 万只）
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

F10_HEADERS = {
    "Referer": "https://fundf10.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

# 旗舰基金池：覆盖股票/混合/指数/债券/货币五类，名称经东财 fundcode_search 核实
FUND_UNIVERSE = [
    ("110022", "易方达消费行业股票", "股票型"),
    ("005827", "易方达蓝筹精选混合", "混合型"),
    ("161725", "招商中证白酒指数(LOF)A", "指数型"),
    ("163406", "兴全合润混合A", "混合型"),
    ("003095", "中欧医疗健康混合A", "混合型"),
    ("000198", "天弘余额宝货币", "货币型"),
    ("110027", "易方达安心回报债券A", "债券型"),
    ("000961", "天弘沪深300ETF联接A", "指数型"),
    ("002011", "华夏红利混合", "混合型"),
    ("260108", "景顺长城新兴成长混合A", "混合型"),
]


def fetch_fund_history(code: str, page_size: int = 30, retries: int = 3) -> list[dict]:
    """单只基金最近 N 个交易日净值（倒序返回，最新在前）。"""
    url = (f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}"
           f"&pageIndex=1&pageSize={page_size}")
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=F10_HEADERS, timeout=20)
            rows = ((resp.json().get("Data") or {}).get("LSJZList")) or []
            if not rows:
                raise ValueError("空净值列表")
            out = []
            for r in rows:
                jzzzl = r.get("JZZZL") or ""
                try:
                    change_pct = float(jzzzl) if jzzzl else None
                except ValueError:
                    change_pct = None
                out.append({
                    "date": r.get("FSRQ"),
                    "nav": float(r["DWJZ"]) if r.get("DWJZ") else None,
                    "acc_nav": float(r["LJJZ"]) if r.get("LJJZ") else None,
                    "change_pct": change_pct,
                })
            return out
        except Exception as e:
            print(f"  [warn] {code} 第 {attempt + 1} 次失败：{type(e).__name__} {e}")
            if attempt < retries - 1:
                time.sleep(2)
    return []


def fetch_full_market() -> list[dict]:
    """全市场基金每日净值快照（akshare；约 2.4 万只 × 11 列）。"""
    try:
        import akshare as ak
    except ImportError:
        print("  [skip] akshare 未安装，跳过全市场快照")
        return []
    try:
        df = ak.fund_open_fund_daily_em()
    except Exception as e:
        print(f"  [warn] 全市场快照失败：{type(e).__name__} {e}")
        return []
    date_cols = [c for c in df.columns if re_match_dates(c)]
    rows = []
    for _, r in df.iterrows():
        nav = r.get(date_cols[0]) if date_cols else None
        acc = r.get(date_cols[1]) if len(date_cols) > 1 else None
        rows.append({
            "code": str(r.get("基金代码") or ""),
            "name": r.get("基金简称") or "",
            "nav": _to_float(nav),
            "acc_nav": _to_float(acc),
            "change_pct": _to_float(r.get("日增长率")),
        })
    return rows


def re_match_dates(col: str) -> bool:
    import re
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}-", col))


def _to_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="旗舰基金数据采集")
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"),
                        help="输出文件名日期")
    parser.add_argument("--no-full-market", action="store_true",
                        help="跳过全市场快照（更快）")
    args = parser.parse_args()

    universe = []
    for code, name, ftype in FUND_UNIVERSE:
        rows = fetch_fund_history(code)
        if not rows:
            print(f"[{code}] {name} 采集失败，跳过")
            continue
        latest = rows[0]
        print(f"[{code}] {name}（{ftype}） {rows[0]['date']} 净值 {latest['nav']}"
              f"  {latest['change_pct']}% ｜ 历史 {len(rows)} 条")
        universe.append({"code": code, "name": name, "type": ftype, "rows": rows})

    full_market = [] if args.no_full_market else fetch_full_market()
    if full_market:
        print(f"[全市场] 共 {len(full_market)} 只基金当日净值")

    result = {
        "date": args.date,
        "schema_version": "fund-daily/1.0",
        "observed_at": datetime.now().astimezone().isoformat(),
        "universe": universe,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / f"fund_{args.date}.json"
    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    print(f"== 旗舰基金池已写入 {out_file} ==")
    if full_market:
        all_file = OUT_DIR / f"fund_all_{args.date}.json"
        all_file.write_text(
            json.dumps({"date": args.date,
                        "schema_version": "fund-daily/1.0",
                        "observed_at": datetime.now().astimezone().isoformat(),
                        "rows": full_market},
                       ensure_ascii=False),
            encoding="utf-8")
        print(f"== 全市场快照已写入 {all_file} ==")


if __name__ == "__main__":
    main()
