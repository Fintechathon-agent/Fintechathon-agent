# -*- coding: utf-8 -*-
"""Daily Market Brief → Hindsight Memory 导入器。

把日报采集产物 `brief/out/market_YYYY-MM-DD.json` 中的结构化数据写入
Memory 的 World Facts 层（`MemoryLayer.FACT`），使日报数据成为可检索、
可追溯的记忆事实。这是审计报告 §10 的修复 P1-1（日报与 Memory 断链）。

设计约束（对齐项目原则）：
- 只导入 JSON 中**已有来源标注或可确定来源**的字段；不确定的不导入。
- 不覆盖历史：每条事实的内容内嵌数据日期与数值，跨日不会互相去重合并。
- 幂等：内容完全一致时走 retain() 的去重增强路径，不重复新增。
- 置信度沿用 retain() 的启发式基线（0.5 起），不人为抬高——该值语义是
  "记忆系统对反复观察到的一致性的评分"，不是统计概率。
- createdAt/updatedAt 由 store 写入；本条目的数据时间写入内容与 tags。

用法：
    python brief/ingest_to_memory.py --date 2026-10-08 --user-id demo_user
    python brief/ingest_to_memory.py --date 2026-10-08 --dry-run   # 只预览
    python brief/ingest_to_memory.py --latest --include-news        # 含快讯
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_DIR = HERE / "out"

# 使 `agent` / `contracts` 可导入（脚本可从仓库任意位置执行）
sys.path.insert(0, str(ROOT))

from agent.core.memory import HindsightMemoryStore  # noqa: E402
from agent.risk.memory_guard import MemoryWriteRejected  # noqa: E402
from contracts.types import MemoryLayer  # noqa: E402


# 各行情分组的来源说明（与 collect_market_data.py 的 fetch 逻辑一致）
GROUP_SOURCE = {
    "a_share": "新浪行情 hq.sinajs.cn",
    "hk": "新浪行情 hq.sinajs.cn",
    "us": "新浪行情 hq.sinajs.cn",
    "commodity": "新浪行情 hq.sinajs.cn",
    "fx": "新浪行情 hq.sinajs.cn",
}


def _load_market_json(date: str | None, use_latest: bool, path: str | None) -> tuple[dict, Path]:
    if path:
        p = Path(path)
    elif date:
        p = OUT_DIR / f"market_{date}.json"
    else:
        files = sorted(OUT_DIR.glob("market_*.json"))
        if not files:
            raise SystemExit("out/ 下没有 market_*.json，请先运行 collect_market_data.py")
        p = files[-1]
    if not p.exists():
        raise SystemExit(f"找不到文件：{p}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{p} 不是合法 JSON：{exc}")
    return data, p


def _fmt_num(v) -> str:
    """指数/价格按量级取小数位：>=1 保留 2 位，<1（汇率等）保留 4 位。
    与日报展示口径一致，避免把 4310.2765 这类采集原值写进记忆。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{f:.4f}" if abs(f) < 1 else f"{f:.2f}"


def build_facts(data: dict, include_news: bool, news_limit: int) -> list[dict]:
    """把日报 JSON 转成待写入的事实列表。

    返回 [{content, source, tags}]，content 内嵌数据日期与数值，
    保证同一条事实在不同日期各自留存、不互相覆盖。
    """
    date = data.get("date", "")
    facts: list[dict] = []

    # ---- 行情（markets.*）----
    for group, rows in (data.get("markets") or {}).items():
        src = GROUP_SOURCE.get(group, "未知")
        for r in rows or []:
            name = r.get("name", "")
            last = r.get("last")
            chg = r.get("change_pct")
            d = r.get("date", "")
            t = r.get("time", "")
            if not name or last is None:
                continue
            when = " ".join(x for x in (d, t) if x)
            facts.append({
                "content": f"{name} {when} 报 {_fmt_num(last)}（{chg:+.2f}%）",
                "source": f"daily_brief:market_{date}.json#markets.{group}（{src}）",
                "tags": ["daily_brief", "market", group, name, date],
            })

    # ---- 美债官方（rates.official，一手来源）----
    off = (data.get("rates") or {}).get("official") or {}
    if off:
        d = off.get("date", "")
        src = off.get("source", "美国财政部官网")
        facts.append({
            "content": (
                f"美国国债收益率 {d}（财政部官方）：10Y {off.get('us10y')}% ｜ "
                f"30Y {off.get('us30y')}%（前一日 {off.get('prev_date','')}："
                f"10Y {off.get('prev_us10y')}% ｜ 30Y {off.get('prev_us30y')}%）"
            ),
            "source": f"daily_brief:market_{date}.json#rates.official（{src}）",
            "tags": ["daily_brief", "rates", "treasury_official", "US10Y", "US30Y", date],
        })

    # ---- 业绩预告（earnings_forecast）----
    ef = data.get("earnings_forecast") or {}
    if ef:
        facts.append({
            "content": (
                f"A 股业绩预告（报告期 {ef.get('report_date','')}）：已披露 {ef.get('total')} 家，"
                f"预喜 {ef.get('positive')} 家、报忧 {ef.get('negative')} 家、"
                f"减亏 {ef.get('loss_narrowed')} 家、不确定 {ef.get('uncertain')} 家"
            ),
            "source": f"daily_brief:market_{date}.json#earnings_forecast（{ef.get('source','')}）",
            "tags": ["daily_brief", "earnings_forecast", "a_share", date],
        })

    # ---- 快讯（news，默认不导入：转载源、量大）----
    if include_news:
        IMPORTANT = {"earnings", "macro", "geopolitics"}
        picked = 0
        for n in data.get("news") or []:
            cats = set(n.get("category") or [])
            if not (cats & IMPORTANT):
                continue
            if picked >= news_limit:
                break
            title = (n.get("title") or "").strip()
            if not title:
                continue
            facts.append({
                "content": f"快讯[{n.get('time','')}] {title}",
                "source": f"daily_brief:market_{date}.json#news（东方财富快讯，二次转载）",
                "tags": ["daily_brief", "news", *sorted(cats), date],
            })
            picked += 1

    return facts


def run(date: str | None, user_id: str, dry_run: bool, include_news: bool,
        news_limit: int, memory_dir: str | None, path: str | None) -> int:
    data, file = _load_market_json(date, use_latest=False, path=path)
    facts = build_facts(data, include_news, news_limit)

    print(f"来源文件：{file}")
    print(f"数据日期：{data.get('date')} ｜ 采集时刻：{data.get('observed_at', '(未标注)')}")
    print(f"拟写入：{len(facts)} 条事实（用户 {user_id}）\n")
    for f in facts:
        print(f"  · {f['content'][:88]}")
        print(f"    source: {f['source']}")

    if dry_run:
        print("\n[dry-run] 未写入。去掉 --dry-run 以执行。")
        return 0

    store_dir = Path(memory_dir) if memory_dir else (ROOT / "data" / "memory")
    store = HindsightMemoryStore(store_dir)

    written, reinforced, blocked = 0, 0, 0
    for f in facts:
        before = store._load_layer(user_id, MemoryLayer.FACT)
        existed = store._find_duplicate(before, f["content"]) is not None
        try:
            store.retain(
                user_id=user_id,
                layer=MemoryLayer.FACT,
                content=f["content"],
                source=f["source"],
                tags=f["tags"],
            )
        except MemoryWriteRejected as exc:
            blocked += 1
            print(f"  ⛔ 写入门卫拦截：{f['content'][:60]}…（{exc}）")
            continue
        if existed:
            reinforced += 1
        else:
            written += 1

    print(f"\n完成：新增 {written} 条、去重增强 {reinforced} 条、门卫拦截 {blocked} 条。")
    print(f"落盘目录：{store_dir / user_id}")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="把日报 JSON 导入 Hindsight 记忆（fact 层）")
    ap.add_argument("--date", help="数据日期 YYYY-MM-DD（默认取 out/ 下最新）")
    ap.add_argument("--file", help="直接指定 market JSON 路径（优先于 --date）")
    ap.add_argument("--user-id", default="demo_user", help="写入哪个用户的记忆")
    ap.add_argument("--dry-run", action="store_true", help="只预览不写入")
    ap.add_argument("--include-news", action="store_true",
                    help="同时导入重点快讯（earnings/macro/geopolitics；默认关闭）")
    ap.add_argument("--news-limit", type=int, default=10, help="快讯最多导入条数")
    ap.add_argument("--memory-dir", help="覆盖记忆根目录（默认 data/memory）")
    args = ap.parse_args()
    sys.exit(run(args.date, args.user_id, args.dry_run, args.include_news,
                 args.news_limit, args.memory_dir, args.file))


if __name__ == "__main__":
    main()
