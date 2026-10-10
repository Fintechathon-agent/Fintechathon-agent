# -*- coding: utf-8 -*-
"""Daily Market Brief → 团队 market_context 导出器。

把日报采集产物 `brief/out/market_YYYY-MM-DD.json` 转换为团队约定格式
（与 `chenchen/data/market-brief-2026-10-08.json` 同构），供 Core Agent
作为 `market_context` 消费。团队 contract 说明见 chenchen/contracts/README.md：
market_context「只表示一份有来源和数据日期的市场简报上下文，用于异常标记和
Risk 复核，不会覆盖或重新计算 Quant 的组合收益」。

映射约定（2026-10-08 由团队手工夹具反向核对，14/14 项一致）：
- 资产 ID / source_status 采用团队既有夹具的分类，集中在本文件 ASSET_MAP，
  需要调整时只改这张表。
- data_time 统一带 +08:00；A 股取收盘 15:00，美股取同批最早报价时刻
  （隔夜行情为同一批收盘数据，避免个别采集回写时刻造成不一致）。
- rates.official（美国财政部官方）→ UST10Y/UST30Y，status=OFFICIAL_SOURCE，
  data_time 取官方数据日期（时间部分为简报发布时段的近似值，日期为准）。

自动生成的边界：
- market / source_checks / limitations：由本脚本机械生成，可验证。
- signals：只生成机械可判定的 ABNORMAL_MOVE（阈值可配）；冲突类
  （PRICE_NEWS_CONFLICT）、利率敏感度、披露节奏等属于 Research 层判断，
  不在自动范围内，需人工补充——这一点会写进输出的 limitations。

用法：
    python brief/export_team_market_context.py --date 2026-10-08
    python brief/export_team_market_context.py --date 2026-10-08 --threshold 3.0
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

# 资产映射（中文名 → asset_id, source_status）。
# source_status 语义（沿用团队夹具）：
#   CROSS_CHECKED  双源交叉核验通过（简报中记录为「新浪 / 东财 push2 交叉一致」）
#   OFFICIAL_SOURCE 官方一手来源（美国财政部）
#   REFERENCE_ONLY 仅单一参考源，未交叉核验
ASSET_MAP: dict[str, tuple[str, str]] = {
    "沪深300": ("CSI300", "CROSS_CHECKED"),
    "上证指数": ("SSE_COMPOSITE", "CROSS_CHECKED"),
    "创业板指": ("CHINEXT", "CROSS_CHECKED"),
    "恒生指数": ("HSI", "CROSS_CHECKED"),
    "道琼斯": ("DOW", "REFERENCE_ONLY"),
    "纳斯达克": ("NASDAQ", "REFERENCE_ONLY"),
    "标普500": ("SP500", "REFERENCE_ONLY"),
    "COMEX黄金": ("COMEX_GOLD", "CROSS_CHECKED"),
    "NYMEX原油": ("NYMEX_CRUDE", "CROSS_CHECKED"),
    "COMEX白银": ("COMEX_SILVER", "CROSS_CHECKED"),
    "NYMEX天然气": ("NYMEX_GAS", "REFERENCE_ONLY"),
    "离岸人民币": ("CNH", "REFERENCE_ONLY"),
}

SOURCE_CHECKS = [
    {"source": "新浪 / 东财 push2", "scope": "A股与商品价格", "status": "CROSS_CHECKED"},
    {"source": "美国财政部官网", "scope": "美债10Y与30Y", "status": "OFFICIAL_SOURCE"},
    {"source": "东财数据中心官方分类", "scope": "业绩预告", "status": "REFERENCE_ONLY"},
]

LIMITATIONS = [
    "本文件由 brief/export_team_market_context.py 从每日市场简报自动导出，不是实时行情接口。",
    "Core Agent 只传递市场上下文和异常证据，不把本文件重新计算为组合收益、回撤或预测。",
    "价格与新闻冲突只进入 Review，不自动转换为买卖动作。",
    "signals 仅含机械判定的异常波动；冲突类、利率敏感度、披露节奏等信号需 Research 层人工补充。",
]


def _truncate_minute(time_str: str) -> str:
    """'15:35:43' → '15:35:00'；非法输入返回空串"""
    m = re.match(r"^(\d{2}):(\d{2})", str(time_str or ""))
    return f"{m.group(1)}:{m.group(2)}:00" if m else ""


def _data_time(date: str, time_str: str, market: str) -> str:
    """拼出带 +08:00 的数据时间；A 股按收盘取 15:00。"""
    t = _truncate_minute(time_str)
    if market == "a_share" and t:
        t = "15:00:00"
    return f"{date}T{t}+08:00" if t else ""


def _round_latest(v):
    """按简报展示精度取整：|值| ≥ 10 取 2 位小数；小额（汇率 6.7046、天然气 3.244）
    保留原始精度——与团队夹具在 2026-10-08 的取值口径一致（14/14 核对过）。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    return round(f, 2) if abs(f) >= 10 else f


def _published_at(date: str, fallback: str) -> str:
    """优先读 brief_日期.md 页脚的「生成时间」，否则回退到采集的 observed_at。

    发布时刻 = 简报定稿时刻（页脚由 make_brief_draft.py 写入），
    采集时刻只是数据落地时间，两者语义不同。
    """
    md = OUT_DIR / f"brief_{date}.md"
    if md.exists():
        m = re.search(r"生成时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", md.read_text(encoding="utf-8"))
        if m:
            return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M").astimezone().isoformat()
    try:
        return datetime.fromisoformat(fallback).isoformat()
    except (TypeError, ValueError):
        return fallback


def export(data: dict, threshold: float = 3.0) -> dict:
    date = data.get("date", "")

    market: list[dict] = []
    for group, rows in (data.get("markets") or {}).items():
        # 美股为同一批隔夜收盘数据：组内取最早时刻，避免个别采集回写差异
        if group == "us" and rows:
            times = [r.get("time", "") for r in rows if _truncate_minute(r.get("time", ""))]
            group_time = min(times) if times else ""
        else:
            group_time = ""

        for row in rows or []:
            name = row.get("name", "")
            mapped = ASSET_MAP.get(name)
            if not mapped:
                continue  # 未登记资产不导出，避免编造 asset_id
            asset_id, status = mapped
            t = group_time if (group == "us" and group_time) else row.get("time", "")
            item = {
                "asset_id": asset_id,
                "name": name,
                "latest": _round_latest(row.get("last")),
                "change_pct": row.get("change_pct"),
                "data_time": _data_time(row.get("date", date), t, group),
                "source_status": status,
            }
            market.append(item)

    # 美债：官方源，最新值与前一交易日
    off = (data.get("rates") or {}).get("official") or {}
    if off:
        for key, prev_key, asset_id, label in (
            ("us10y", "prev_us10y", "UST10Y", "美债10Y"),
            ("us30y", "prev_us30y", "UST30Y", "美债30Y"),
        ):
            if off.get(key) is None:
                continue
            item = {
                "asset_id": asset_id,
                "name": label,
                "latest": _round_latest(off.get(key)),
                "change_pct": None,
                "data_time": f"{off.get('date', date)}T18:00:00+08:00",
                "source_status": "OFFICIAL_SOURCE",
            }
            if off.get(prev_key) is not None:
                item["previous_value"] = off.get(prev_key)
            market.append(item)

    # 机械异常信号：|涨跌幅| ≥ 阈值
    signals = []
    for item in market:
        pct = item.get("change_pct")
        if pct is None or abs(pct) < threshold:
            continue
        signals.append({
            "signal_id": item["asset_id"].lower().replace("_", "-") + "-abnormal-move",
            "type": "ABNORMAL_MOVE",
            "status": "OBSERVED",
            "asset_ids": [item["asset_id"]],
            "reason": f"{item['name']}单日变动 {pct:+.2f}%，达到异常检测阈值 {threshold:g}%",
            "observed_change_pct": pct,
            "threshold_pct": threshold,
        })

    return {
        "brief_id": f"market-brief-{date}",
        "as_of": date,
        "published_at": _published_at(date, data.get("observed_at", "")),
        "data_mode": "AUTO_BRIEF",
        "source_reference": f"brief/out/market_{date}.json（自动导出）",
        "market": market,
        "signals": signals,
        "source_checks": SOURCE_CHECKS,
        "limitations": LIMITATIONS,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="日报 JSON → 团队 market_context")
    ap.add_argument("--date", help="数据日期（默认取 out/ 下最新）")
    ap.add_argument("--file", help="直接指定 market JSON（优先于 --date）")
    ap.add_argument("--threshold", type=float, default=3.0, help="异常波动阈值（百分点，默认 3）")
    ap.add_argument("--out", help="输出文件（默认 out/team_market_context_日期.json）")
    args = ap.parse_args()

    if args.file:
        src = Path(args.file)
    elif args.date:
        src = OUT_DIR / f"market_{args.date}.json"
    else:
        files = sorted(OUT_DIR.glob("market_*.json"))
        if not files:
            sys.exit("out/ 下没有 market_*.json")
        src = files[-1]
    if not src.exists():
        sys.exit(f"找不到 {src}")

    data = json.loads(src.read_text(encoding="utf-8"))
    out = export(data, args.threshold)

    dst = Path(args.out) if args.out else OUT_DIR / f"team_market_context_{data['date']}.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"已导出：{dst}")
    print(f"  market  {len(out['market'])} 项"
          f"（CROSS_CHECKED {sum(1 for m in out['market'] if m['source_status']=='CROSS_CHECKED')} /"
          f" OFFICIAL_SOURCE {sum(1 for m in out['market'] if m['source_status']=='OFFICIAL_SOURCE')} /"
          f" REFERENCE_ONLY {sum(1 for m in out['market'] if m['source_status']=='REFERENCE_ONLY')}）")
    print(f"  signals {len(out['signals'])} 条（仅机械异常；其余需 Research 层补充）")
    print(f"  as_of {out['as_of']} ｜ published_at {out['published_at']}")


if __name__ == "__main__":
    main()
