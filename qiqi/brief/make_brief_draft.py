# -*- coding: utf-8 -*-
"""Daily Market Brief · 草稿生成器

读入 collect_market_data.py 产出的 JSON，机械地拼出「群聊版 + 飞书版」草稿：
- 行情表、涨跌自动计算
- 异常波动自动识别（|涨跌| ≥ 阈值，或同组内相对极值）
- 快讯按分类挑选重点候选（earnings / macro / policy / geopolitics 优先）
- 业绩预告摘要
- 「为什么值得关注」「今日问题」留为待填占位，由人（或 LLM）补齐

用法：
    python make_brief_draft.py                     # 用最新的 out/market_*.json
    python make_brief_draft.py --date 2026-10-08   # 指定日期
    python make_brief_draft.py --file out/market_2026-10-08.json

输出：
    out/group_YYYY-MM-DD.txt   群聊版草稿
    out/brief_YYYY-MM-DD.md    飞书版草稿
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

ANOMALY_THRESHOLD = 2.0  # |涨跌%| ≥ 该值即标记为异常波动
# 快讯候选优先级：重大新闻 > 财报（财报另有独立板块与汇总行，故排后）
NEWS_PRIORITY = ["macro", "geopolitics", "policy", "earnings", "commodity"]
TBD = "【待填】"


def load_json(path: Path | None, date: str | None) -> tuple[dict, Path]:
    if path:
        return json.loads(path.read_text(encoding="utf-8")), path
    if date:
        p = OUT_DIR / f"market_{date}.json"
    else:
        files = sorted(OUT_DIR.glob("market_*.json"))
        if not files:
            raise SystemExit("out/ 下没有 market_*.json，请先运行 collect_market_data.py")
        p = files[-1]
    if not p.exists():
        raise SystemExit(f"找不到数据文件：{p}")
    return json.loads(p.read_text(encoding="utf-8")), p


def all_quotes(data: dict) -> list[dict]:
    rows = []
    for group in ("a_share", "hk", "us", "commodity", "fx"):
        for r in data["markets"].get(group, []):
            rows.append({**r, "group": group})
    return rows


def fmt_pct(v: float) -> str:
    return f"{v:+.2f}%"


def anomalies(rows: list[dict]) -> list[dict]:
    return sorted([r for r in rows if abs(r["change_pct"]) >= ANOMALY_THRESHOLD],
                  key=lambda r: -abs(r["change_pct"]))


def pick_news(news: list[dict], limit: int = 6) -> list[dict]:
    def rank(n: dict) -> tuple:
        cats = NEWS_PRIORITY
        score = min((cats.index(c) for c in n["category"] if c in cats), default=len(cats))
        return (score,)

    hits = [n for n in news if set(n["category"]) & set(NEWS_PRIORITY)]
    return sorted(hits, key=rank)[:limit]


def rates_line(data: dict) -> str:
    """美债表述：优先用美国财政部官方值（一手），FRED 作滞后备选。"""
    off = data["rates"].get("official")
    if off:
        line = (f"- 美债（财政部官方 {off['date']}）：30Y {off['us30y']}% ｜ 10Y {off['us10y']}%"
                f"（前一日 {off['prev_date']}：30Y {off['prev_us30y']}% ｜ 10Y {off['prev_us10y']}%）")
        return line
    rate10, rate30 = data["rates"].get("us10y"), data["rates"].get("us30y")
    if rate10 or rate30:
        r_parts = []
        if rate30:
            r_parts.append(f"30Y {rate30['value']}%（{rate30['date']}）")
        if rate10:
            r_parts.append(f"10Y {rate10['value']}%（{rate10['date']}）")
        return "- 美债：" + " ｜ ".join(r_parts) + "（来源 FRED，有 1-2 交易日滞后）"
    return ""


def earnings_line(ef: dict) -> str:
    return (f"业绩预告（报告期 {ef['report_date']}）：已披露 {ef['total']} 家，"
            f"预喜 {ef['positive']} 家、报忧 {ef['negative']} 家、"
            f"减亏 {ef.get('loss_narrowed', 0)} 家、不确定 {ef.get('uncertain', 0)} 家")


def build_group(data: dict) -> str:
    rows = all_quotes(data)
    d = datetime.strptime(data["date"], "%Y-%m-%d")
    anom = anomalies(rows)
    news = pick_news(data["news"])

    lines = [f"【Daily Market Brief｜{d.strftime('%m/%d')}】", ""]
    lines.append("**1. Market**")
    for key, name in (("a_share", "A股"), ("hk", "港股"), ("us", "美股"), ("commodity", "商品")):
        group_rows = [r for r in rows if r["group"] == key]
        if group_rows:
            parts = [f"{r['name']} {fmt_pct(r['change_pct'])}" for r in group_rows]
            lines.append(f"- {name}：" + " ｜ ".join(parts))
    rl = rates_line(data)
    if rl:
        lines.append(rl)
    lines.append("")

    lines.append("**2. Key Event**")
    marks = "①②③④⑤⑥⑦⑧⑨"
    idx = 0
    if anom:
        lines.append(f"{marks[idx]} 异常波动：" + "；".join(
            f"{r['name']} {fmt_pct(r['change_pct'])}" for r in anom[:4]))
        idx += 1
    for n in news[:max(0, 3 - idx)]:
        lines.append(f"{marks[idx]} {n['title']}（{n['time'][11:16]}）")
        idx += 1
    ef = data.get("earnings_forecast")
    if ef:
        lines.append(f"{marks[idx]} {earnings_line(ef)}")
    lines.append("")

    lines.append("**3. Why it matters**")
    lines.append(f"1. {TBD}（基于数据，不靠感觉；推断需标注「推断」）")
    lines.append("")

    lines.append("**4. Agent Mapping**")
    lines.append(f"- {TBD}：Data（行情/异常检测）/ Research（研判）/ Risk（风险因子）/ Memory（事实入库）")
    lines.append("")

    lines.append("**5. Question**")
    lines.append(f"{TBD}（留一个带选项的问题，让大家回复选项+理由）")
    lines.append("")
    lines.append("完整版见飞书文档「Daily Market Brief」章节。")
    return "\n".join(lines) + "\n"


def build_feishu(data: dict) -> str:
    rows = all_quotes(data)
    d = datetime.strptime(data["date"], "%Y-%m-%d")
    anom = anomalies(rows)
    news = pick_news(data["news"])
    ef = data.get("earnings_forecast")

    out = [f"# Daily Market Brief · {data['date']}", "",
           f"### {d.strftime('%Y-%m-%d')}（周{'一二三四五六日'[d.weekday()]}）", ""]

    out.append("**① 市场行情**")
    out.append("| 资产 | 最新 | 涨跌 | 数据时间 |")
    out.append("| --- | --- | --- | --- |")
    for r in rows:
        out.append(f"| {r['name']} | {r['last']} | {fmt_pct(r['change_pct'])} | {r.get('date','')} {r.get('time','')} |")
    off = data["rates"].get("official")
    if off:
        out.append(f"| 美债10Y | {off['us10y']}% | — | {off['date']}（美国财政部官方） |")
        out.append(f"| 美债30Y | {off['us30y']}% | — | {off['date']}（美国财政部官方） |")
    else:
        for k, label in (("us10y", "美债10Y"), ("us30y", "美债30Y")):
            rt = data["rates"].get(k)
            if rt:
                out.append(f"| {label} | {rt['value']}% | — | {rt['date']}（FRED 滞后） |")
    out.append("")

    out.append("**② 异常波动**")
    if anom:
        for r in anom:
            out.append(f"- {r['name']}：{fmt_pct(r['change_pct'])}（最新 {r['last']}）")
    else:
        out.append(f"- 今日无单项超 ±{ANOMALY_THRESHOLD}% 的资产；{TBD}（可补充同组相对极值、成交量异常）")
    out.append("")

    out.append("**③ 重要财报**")
    if ef:
        out.append(f"- A 股{earnings_line(ef)}（来源：东财数据中心官方分类）")
        out.append(f"  - 明细：{ef.get('breakdown', {})}")
    earn_news = [n for n in data["news"] if "earnings" in n["category"]]
    for n in earn_news[:3]:
        out.append(f"- {n['title']}（{n['time'][11:16]}）")
    if not ef and not earn_news:
        out.append(f"- {TBD}")
    out.append("")

    out.append("**④ 重大新闻**")
    macro_news = [n for n in data["news"]
                  if set(n["category"]) & {"macro", "policy", "geopolitics"}]
    for n in macro_news[:5]:
        out.append(f"- {n['title']}（{n['time'][11:16]}，{','.join(n['category'])}）")
    if not macro_news:
        out.append(f"- {TBD}")
    out.append("")

    out.append("**⑤ 一句解释**")
    out.append(f"- {TBD}")
    out.append("")
    out.append("**⑥ Agent 映射**")
    out.append(f"- {TBD}（标注进入 Data / Research / Risk / Memory 哪一层，以及未来怎么用）")
    out.append("")
    out.append("**⑦ 今日问题**")
    out.append(f"- {TBD}")
    out.append("")
    out.append(f"*数据留档：{TBD}｜生成时间：{data['generated_at']}*")
    return "\n".join(out) + "\n"


def main() -> None:
    p = argparse.ArgumentParser(description="Daily Market Brief 草稿生成")
    p.add_argument("--date", help="用 out/market_日期.json")
    p.add_argument("--file", help="直接指定数据文件")
    p.add_argument("--force", action="store_true", help="覆盖已补齐的成稿（默认保护，不覆盖）")
    args = p.parse_args()

    data, src = load_json(Path(args.file) if args.file else None, args.date)
    date = data["date"]

    # 成稿保护：已补齐【待填】的版本不会被重新起草覆盖（同日重复运行安全的护栏）
    f_path = OUT_DIR / f"brief_{date}.md"
    if f_path.exists() and TBD not in f_path.read_text(encoding="utf-8") and not args.force:
        print(f"[skip] {f_path.name} 已是补齐后的成稿（无【待填】），为避免冲掉人工内容未覆盖；确实要重新起草请加 --force")
        return

    group = build_group(data)
    feishu = build_feishu(data)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    g_path = OUT_DIR / f"group_{date}.txt"
    g_path.write_text(group, encoding="utf-8")
    f_path.write_text(feishu, encoding="utf-8")

    todo = group.count(TBD) + feishu.count(TBD)
    print(f"数据源：{src}")
    print(f"[ok] 群聊版草稿 → {g_path}")
    print(f"[ok] 飞书版草稿 → {f_path}")
    print(f"待填占位 {todo} 处（搜索 `{TBD}` 逐条补齐：why it matters / agent mapping / question）")


if __name__ == "__main__":
    main()
