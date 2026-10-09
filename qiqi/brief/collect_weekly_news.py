# -*- coding: utf-8 -*-
"""周度快讯扫描：节流翻页抓取东财快讯并按关键词筛选（周报核验用）。

带重试 + 节流，避免触发源站限流。结果存 out/weekly_news_scan.json。
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
OUT = Path("out")

# 核实目标：周报里出现但日报未见的说法
KEYWORDS = ["非农", "就业", "失业", "飓风", "墨西哥湾", "英伟达", "并购", "收购",
            "降息", "算力", "数据中心", "ADP", "ISM", "美联储", "指引", "标普",
            "纳指", "道指"]


def fetch_page(page: int, retries: int = 4) -> list[dict]:
    url = f"https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_100_{page}_.html"
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            m = re.search(r"var ajaxResult=(.*)", r.text, re.S)
            if m:
                return json.loads(m.group(1).strip().rstrip(";")).get("LivesList", [])
        except Exception:
            pass
        time.sleep(4 + attempt * 3)
    return []


hits: list[dict] = []
seen = set()
all_days: dict[str, int] = {}

for page in range(1, 18):
    items = fetch_page(page)
    if not items:
        print(f"page {page}: 取空（限流或结束）")
        time.sleep(4)
        continue
    first, last = items[0].get("showtime", ""), items[-1].get("showtime", "")
    print(f"page {page}: {len(items)} 条  {first[:16]} ~ {last[:16]}")
    for it in items:
        t = (it.get("title") or "").strip()
        d = (it.get("showtime") or "")[:10]
        if d:
            all_days[d] = all_days.get(d, 0) + 1
        if t and t not in seen and any(k in t for k in KEYWORDS):
            seen.add(t)
            hits.append({"time": it.get("showtime", ""), "title": t,
                         "digest": (it.get("digest") or "")[:300]})
    if first[:10] < "2026-10-01":
        print("已回溯到 10/01 之前，停止")
        break
    time.sleep(2.5)

hits.sort(key=lambda x: x["time"])
print("\n=== 每日条数 ===")
for d in sorted(all_days):
    print(f"  {d}: {all_days[d]}")

print(f"\n=== 关键词命中 {len(hits)} 条 ===")
for h in hits:
    print(f"  {h['time'][:16]}  {h['title'][:95]}")

(OUT / "weekly_news_scan.json").write_text(
    json.dumps({"news_hits": hits, "daily_counts": all_days},
               ensure_ascii=False, indent=2), encoding="utf-8")
print("\n已存 out/weekly_news_scan.json")
