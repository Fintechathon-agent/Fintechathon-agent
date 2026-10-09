# -*- coding: utf-8 -*-
"""Daily Market Brief · 数据采集脚本

为每日市场简报采集「行情 / 利率 / 快讯 / 业绩预告」，输出 JSON 到 out/。

数据源（2026-10-07 实测可用）：
- 新浪行情   hq.sinajs.cn（需 Referer: https://finance.sina.com.cn）
- 东财快讯   newsapi.eastmoney.com/kuaixun/...
- FRED 美债  fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10|DGS30（有 1-2 个交易日滞后）
- akshare    东方财富业绩预告（A 股三季报预告汇总，可选）

用法：
    python collect_market_data.py                    # 采集今天
    python collect_market_data.py --date 2026-10-08  # 指定日期（仅影响输出文件名）
    python collect_market_data.py --no-akshare       # 跳过业绩预告（更快）

输出：
    out/market_YYYY-MM-DD.json   结构化数据
    stdout                       人读摘要（供撰写简报用）
"""
from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

SINA_HEADERS = {
    "Referer": "https://finance.sina.com.cn",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

# 代码 -> 中文名。只放「核心资产」，避免简报变成行情播报。
A_SHARE = {
    "sh000300": "沪深300",
    "sh000001": "上证指数",
    "sz399006": "创业板指",
}
HK_CODES = {"rt_hkHSI": "恒生指数"}
US_CODES = {"gb_dji": "道琼斯", "gb_ixic": "纳斯达克", "gb_inx": "标普500"}
COMMODITY = {
    "hf_GC": "COMEX黄金",
    "hf_CL": "NYMEX原油",
    "hf_SI": "COMEX白银",
    "hf_NG": "NYMEX天然气",
}
FX_CODES = {"fx_susdcnh": "离岸人民币"}

# 快讯分类关键词（命中即打标，用于「筛选 1-3 条重点」）
NEWS_RULES = [
    ("earnings", ["财报", "业绩", "营收", "净利润", "预告", "超预期", "低于预期", "EPS", "季报", "年报"]),
    ("macro", ["美联储", "央行", "利率", "国债", "收益率", "CPI", "GDP", "非农", "降息", "加息", "关税", "汇率"]),
    ("policy", ["政策", "国务院", "发改委", "证监会", "财政部", "监管", "关税", "补贴", "试点"]),
    ("company", ["减持", "增持", "回购", "目标价", "上调", "下调", "评级", "签单", "中标", "投产"]),
    ("commodity", ["黄金", "原油", "白银", "铜", "锂", "稀土", "天然气"]),
    ("geopolitics", ["伊朗", "以色列", "俄乌", "制裁", "战争", "冲突", "袭击"]),
]


def fetch_sina(codes: list[str]) -> dict[str, list[str]]:
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)
    resp = requests.get(url, headers=SINA_HEADERS, timeout=10)
    resp.encoding = "gbk"
    rows: dict[str, list[str]] = {}
    for line in resp.text.strip().splitlines():
        m = re.match(r'var hq_str_([\w$]+)="(.*)";', line)
        if not m:
            continue
        payload = m.group(2)
        if payload:
            rows[m.group(1)] = payload.split(",")
    return rows


def _find(fields: list[str], pattern: str) -> str:
    for f in fields:
        if re.match(pattern, f or ""):
            return f
    return ""


def _pct(last: float, prev: float) -> float:
    return round((last - prev) / prev * 100, 2) if prev else 0.0


def parse_a_share(rows: dict[str, list[str]]) -> list[dict]:
    out = []
    for code, name in A_SHARE.items():
        f = rows.get(code)
        if not f:
            continue
        try:
            prev, last = float(f[2]), float(f[3])
            out.append({
                "name": name, "last": last, "change": round(last - prev, 2),
                "change_pct": _pct(last, prev),
                "date": _find(f, r"^\d{4}-\d{2}-\d{2}$"),
                "time": _find(f, r"^\d{2}:\d{2}:\d{2}$"),
            })
        except (IndexError, ValueError):
            continue
    return out


def parse_hk(rows: dict[str, list[str]]) -> list[dict]:
    out = []
    for code, name in HK_CODES.items():
        f = rows.get(code)
        if not f:
            continue
        try:
            prev, last = float(f[3]), float(f[6])
            out.append({
                "name": name, "last": last, "change": round(float(f[7]), 2),
                "change_pct": round(float(f[8]), 2),
                "date": _find(f, r"^\d{4}/\d{2}/\d{2}$").replace("/", "-"),
                "time": _find(f, r"^\d{2}:\d{2}:\d{2}$"),
            })
        except (IndexError, ValueError):
            continue
    return out


def parse_us(rows: dict[str, list[str]]) -> list[dict]:
    out = []
    for code, name in US_CODES.items():
        f = rows.get(code)
        if not f:
            continue
        try:
            out.append({
                "name": name, "last": float(f[1]),
                "change": float(f[4]), "change_pct": float(f[2]),
                "date": f[3][:10], "time": f[3][11:19],
            })
        except (IndexError, ValueError):
            continue
    return out


def parse_commodity(rows: dict[str, list[str]]) -> list[dict]:
    out = []
    for code, name in COMMODITY.items():
        f = rows.get(code)
        if not f:
            continue
        try:
            last, prev = float(f[0]), float(f[7])
            out.append({
                "name": name, "last": last, "change": round(last - prev, 3),
                "change_pct": _pct(last, prev),
                "date": f[12] if len(f) > 12 else "", "time": f[6],
            })
        except (IndexError, ValueError):
            continue
    return out


def parse_fx(rows: dict[str, list[str]]) -> list[dict]:
    out = []
    for code, name in FX_CODES.items():
        f = rows.get(code)
        if not f:
            continue
        try:
            last, prev = float(f[8]), float(f[5])
            out.append({
                "name": name, "last": last, "change": round(last - prev, 4),
                "change_pct": _pct(last, prev),
                "date": f[-1] if re.match(r"^\d{4}-\d{2}-\d{2}$", f[-1]) else "",
                "time": f[0],
            })
        except (IndexError, ValueError):
            continue
    return out


def fetch_fred(series: str, retries: int = 3) -> dict | None:
    """FRED 单序列，返回最近一个有效值。注意有 1-2 个交易日滞后。"""
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=20)
            last_date = last_val = None
            for line in resp.text.strip().splitlines()[1:]:
                parts = line.split(",")
                if len(parts) == 2 and parts[1] not in (".", ""):
                    last_date, last_val = parts[0], float(parts[1])
            if last_date:
                return {"series": series, "date": last_date, "value": last_val}
        except Exception:
            pass
        if attempt < retries - 1:
            time.sleep(2)
    return None


TREASURY_CSV = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
                "daily-treasury-rates.csv/{y}/all?type=daily_treasury_yield_curve"
                "&field_tdr_date_value={y}&page&_format=csv")


def fetch_treasury_official(retries: int = 3) -> dict | None:
    """美国财政部官网每日收益率曲线（一手来源）。

    每日美东下午发布，北京时间次日凌晨可得，比 FRED 早约 1 个交易日。
    CSV 为倒序（最新在前），这里统一解析后按日期排序，返回最近两日。
    """
    year = datetime.now().year
    url = TREASURY_CSV.format(y=year)
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
            lines = [ln for ln in resp.text.strip().splitlines() if ln.strip()]
            if len(lines) < 2:
                raise ValueError("空 CSV")
            header = [h.strip().strip('"') for h in lines[0].split(",")]
            i10, i30 = header.index("10 Yr"), header.index("30 Yr")
            rows = []
            for ln in lines[1:]:
                parts = ln.split(",")
                if len(parts) != len(header):
                    continue
                try:
                    rows.append((parts[0], float(parts[i10]), float(parts[i30])))
                except ValueError:
                    continue
            rows.sort(key=lambda r: datetime.strptime(r[0], "%m/%d/%Y"))
            if rows:
                latest = rows[-1]
                prev = rows[-2] if len(rows) > 1 else None
                return {
                    "date": datetime.strptime(latest[0], "%m/%d/%Y").strftime("%Y-%m-%d"),
                    "us10y": latest[1], "us30y": latest[2],
                    "prev_date": datetime.strptime(prev[0], "%m/%d/%Y").strftime("%Y-%m-%d") if prev else "",
                    "prev_us10y": prev[1] if prev else None,
                    "prev_us30y": prev[2] if prev else None,
                    "source": "美国财政部官网 daily_treasury_yield_curve",
                }
        except Exception as e:
            print(f"  [warn] 财政部收益率第 {attempt + 1} 次失败：{type(e).__name__}")
            if attempt < retries - 1:
                time.sleep(3)
    return None


def fetch_news(limit: int = 100) -> list[dict]:
    url = f"https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_{limit}_1_.html"
    resp = requests.get(url, timeout=15)
    m = re.search(r"var ajaxResult=(.*)", resp.text, re.S)
    if not m:
        return []
    data = json.loads(m.group(1).strip().rstrip(";"))
    items = []
    for it in data.get("LivesList", []):
        title = (it.get("title") or "").strip()
        if not title:
            continue
        cats = [c for c, kws in NEWS_RULES if any(k in title for k in kws)]
        items.append({
            "time": it.get("showtime", ""),
            "title": title,
            "category": cats or ["other"],
            "url": it.get("url_w", ""),
        })
    return items


# 东财业绩预告分类（PREDICT_TYPE 字段口径）
# 预喜：媒体通用口径（预增 + 略增 + 续盈 + 扭亏）；减亏仍为亏损、单独计
POSITIVE_TYPES = ("预增", "略增", "续盈", "扭亏")
NEGATIVE_TYPES = ("预减", "略减", "首亏", "续亏")


def fetch_earnings_forecast(retries: int = 3) -> dict | None:
    """A 股业绩预告汇总（东方财富数据中心直连，按 PREDICT_TYPE 分类统计）。

    不用 akshare 的关键词文本匹配（那会把口径算宽），直接取官方分类字段
    PREDICT_TYPE，按「向好 / 报忧 / 不确定」三档统计。
    """
    now = datetime.now()
    quarter_ends = [f"{now.year}1231", f"{now.year}0930", f"{now.year}0630", f"{now.year}0331",
                    f"{now.year - 1}1231"]
    readable = now.strftime("%Y%m%d")
    date = next((q for q in quarter_ends if q <= readable), quarter_ends[0])
    iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    url = ("https://datacenter-web.eastmoney.com/api/data/v1/get"
           "?sortColumns=NOTICE_DATE,SECURITY_CODE&sortTypes=-1,-1"
           "&pageSize=500&pageNumber=1&reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=ALL"
           f"&filter=(REPORT_DATE%3D%27{iso}%27)")
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            data = resp.json()
            rows = (data.get("result") or {}).get("data") or []
            if not rows:
                raise ValueError("无数据")
            counts: dict[str, int] = {}
            for r in rows:
                t = str(r.get("PREDICT_TYPE") or "未分类")
                counts[t] = counts.get(t, 0) + 1
            positive = sum(v for k, v in counts.items() if k in POSITIVE_TYPES)
            negative = sum(v for k, v in counts.items() if k in NEGATIVE_TYPES)
            improve = counts.get("减亏", 0)
            return {
                "report_date": date,
                "total": len(rows),
                "positive": positive,
                "negative": negative,
                "loss_narrowed": improve,
                "uncertain": len(rows) - positive - negative - improve,
                "breakdown": counts,
                "source": "东方财富数据中心 RPT_PUBLIC_OP_NEWPREDICT（PREDICT_TYPE 分类）",
            }
        except Exception as e:
            print(f"  [warn] 业绩预告第 {attempt + 1} 次失败：{type(e).__name__}")
            if attempt < retries - 1:
                time.sleep(5)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Market Brief 数据采集")
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"), help="输出文件名日期")
    parser.add_argument("--skip-earnings", "--no-akshare", dest="skip_earnings",
                        action="store_true", help="跳过业绩预告采集（更快；--no-akshare 为兼容旧称）")
    args = parser.parse_args()

    codes = list(A_SHARE) + list(HK_CODES) + list(US_CODES) + list(COMMODITY) + list(FX_CODES)
    sina = fetch_sina(codes)

    result = {
        "date": args.date,
        # schema_version：契约版本号，字段变更时递增（见 docs/审计报告 §3）。
        # observed_at：采集时刻，ISO 8601 带时区；generated_at 保留原格式以兼容
        # 既有消费者（make_brief_draft.py 的「生成时间」展示）。
        "schema_version": "daily-brief/1.0",
        "observed_at": datetime.now().astimezone().isoformat(),
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "markets": {
            "a_share": parse_a_share(sina),
            "hk": parse_hk(sina),
            "us": parse_us(sina),
            "commodity": parse_commodity(sina),
            "fx": parse_fx(sina),
        },
        "rates": {
            "official": fetch_treasury_official(),
            "us10y": fetch_fred("DGS10"),
            "us30y": fetch_fred("DGS30"),
        },
        "news": fetch_news(),
        "earnings_forecast": None if args.skip_earnings else fetch_earnings_forecast(),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / f"market_{args.date}.json"
    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    # 控制台摘要
    print(f"== 数据已写入 {out_file} ==")
    for group in ("a_share", "hk", "us", "commodity", "fx"):
        rows = result["markets"][group]
        if rows:
            print(f"\n[{group}]")
            for r in rows:
                print(f"  {r['name']:8s} {r['last']:>12}  {r['change_pct']:+.2f}%  ({r['date']} {r['time']})")
    for key, rate in result["rates"].items():
        if not rate:
            continue
        if key == "official":
            print(f"\n[美债·官方] {rate['date']}：10Y {rate['us10y']}% ｜ 30Y {rate['us30y']}%"
                  f"（前一日 {rate['prev_date']}：10Y {rate['prev_us10y']}% ｜ 30Y {rate['prev_us30y']}%）")
        else:
            print(f"[{key}·FRED] {rate['value']}  ({rate['date']}, 比官方滞后)")
    if result["earnings_forecast"]:
        ef = result["earnings_forecast"]
        print(f"\n[业绩预告] 报告期 {ef['report_date']} 共 {ef['total']} 家："
              f"预喜 {ef['positive']} 家 / 报忧 {ef['negative']} 家 / "
              f"减亏 {ef['loss_narrowed']} 家 / 不确定 {ef['uncertain']} 家")
        print(f"  分类明细：{ef['breakdown']}")
    print(f"\n[快讯] 共 {len(result['news'])} 条，按分类计数：")
    counts: dict[str, int] = {}
    for n in result["news"]:
        for c in n["category"]:
            counts[c] = counts.get(c, 0) + 1
    print("  " + "  ".join(f"{k}:{v}" for k, v in sorted(counts.items(), key=lambda x: -x[1])))
    print("\n[重点候选：earnings / macro / geopolitics]")
    for n in result["news"]:
        if set(n["category"]) & {"earnings", "macro", "geopolitics"}:
            print(f"  {n['time'][11:16]} [{','.join(n['category'])}] {n['title'][:60]}")


if __name__ == "__main__":
    main()
