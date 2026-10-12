# -*- coding: utf-8 -*-
"""私有市场数据库（SQLite）——市场日报与「理财旗舰」的本地数据底座。

定位（2026-10-12 定）：
- 数据源是核心资产：只存本机 brief/db/market.db，已加入 .gitignore，
  不进 GitHub、不外发；对外分享只走「日报五件套」成品文档。
- 所有写入幂等（主键 INSERT OR IGNORE / upsert），采集脚本每天跑、
  手动回填都不会产生重复行。
- 消费方：ingest_to_db.py（回填）、collect_*（当日入库）、
  产品侧读取（query 系列函数）。

表：
- quotes       每日行情快照（指数/个股/ETF/商品/汇率，含产品投资池 universe）
- rates        利率（美债 10Y/30Y：财政部官方 + FRED 双源）
- news         快讯（按 (date, title) 去重）
- earnings     业绩预告汇总（按 (date, report_date) 去重）
- fund_nav     旗舰基金池净值历史（按 (code, date) 去重）
- fund_all     全市场基金每日净值快照（按 (code, date) 去重）
- brief_events 事件→解释→风险→决策 标注数据集（briefs_21d.jsonl）
- briefs       成稿留档（群聊版 + 飞书版正文）
- meta         库元信息
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "db" / "market.db"
SCHEMA_VERSION = "market-db/1.0"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS quotes(
  date TEXT NOT NULL,
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  last REAL,
  change REAL,
  change_pct REAL,
  as_of_date TEXT,
  as_of_time TEXT,
  PRIMARY KEY(date, market, code)
);
CREATE TABLE IF NOT EXISTS rates(
  date TEXT NOT NULL,
  series TEXT NOT NULL,
  value REAL,
  as_of TEXT,
  source TEXT NOT NULL,
  PRIMARY KEY(date, series, source)
);
CREATE TABLE IF NOT EXISTS news(
  date TEXT NOT NULL,
  news_time TEXT,
  title TEXT NOT NULL,
  category TEXT,
  url TEXT,
  PRIMARY KEY(date, title)
);
CREATE TABLE IF NOT EXISTS earnings(
  date TEXT NOT NULL,
  report_date TEXT NOT NULL,
  total INTEGER,
  positive INTEGER,
  negative INTEGER,
  loss_narrowed INTEGER,
  uncertain INTEGER,
  breakdown TEXT,
  source TEXT,
  PRIMARY KEY(date, report_date)
);
CREATE TABLE IF NOT EXISTS fund_nav(
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  ftype TEXT,
  nav REAL,
  acc_nav REAL,
  change_pct REAL,
  PRIMARY KEY(code, date)
);
CREATE TABLE IF NOT EXISTS fund_all(
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  nav REAL,
  acc_nav REAL,
  change_pct REAL,
  PRIMARY KEY(code, date)
);
CREATE TABLE IF NOT EXISTS brief_events(
  id TEXT PRIMARY KEY,
  date TEXT,
  event_type TEXT,
  headline TEXT,
  explanation TEXT,
  risk TEXT,
  agent_mapping TEXT,
  decision TEXT,
  raw TEXT
);
CREATE TABLE IF NOT EXISTS briefs(
  date TEXT PRIMARY KEY,
  title TEXT,
  group_text TEXT,
  feishu_md TEXT,
  updated_at TEXT
);
"""


def connect() -> sqlite3.Connection:
    """打开（或创建）数据库并确保表结构存在。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)",
        (SCHEMA_VERSION,),
    )
    return conn


def _j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False) if obj is not None else None


# ------------------------------------------------------------ 写入（幂等）

def upsert_quote(conn: sqlite3.Connection, date: str, market: str, code: str,
                 name: str, last: float, change: float, change_pct: float,
                 as_of_date: str = "", as_of_time: str = "") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO quotes(date, market, code, name, last, change,"
        " change_pct, as_of_date, as_of_time) VALUES(?,?,?,?,?,?,?,?,?)",
        (date, market, code, name, last, change, change_pct, as_of_date, as_of_time),
    )


def upsert_rate(conn: sqlite3.Connection, date: str, series: str, value: float,
                as_of: str = "", source: str = "unknown") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO rates(date, series, value, as_of, source)"
        " VALUES(?,?,?,?,?)",
        (date, series, value, as_of, source),
    )


def upsert_news(conn: sqlite3.Connection, date: str, news_time: str, title: str,
                category: str, url: str = "") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO news(date, news_time, title, category, url)"
        " VALUES(?,?,?,?,?)",
        (date, news_time, title, category, url),
    )


def upsert_earnings(conn: sqlite3.Connection, date: str, report_date: str,
                    row: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO earnings(date, report_date, total, positive,"
        " negative, loss_narrowed, uncertain, breakdown, source)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (date, report_date, row.get("total"), row.get("positive"),
         row.get("negative"), row.get("loss_narrowed"), row.get("uncertain"),
         _j(row.get("breakdown")), row.get("source")),
    )


def upsert_fund_nav(conn: sqlite3.Connection, code: str, date: str, name: str,
                    ftype: str, nav: float, acc_nav: float, change_pct: float) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO fund_nav(code, date, name, ftype, nav, acc_nav,"
        " change_pct) VALUES(?,?,?,?,?,?,?)",
        (code, date, name, ftype, nav, acc_nav, change_pct),
    )


def upsert_fund_all(conn: sqlite3.Connection, code: str, date: str, name: str,
                    nav: float, acc_nav: float, change_pct: float) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO fund_all(code, date, name, nav, acc_nav, change_pct)"
        " VALUES(?,?,?,?,?,?)",
        (code, date, name, nav, acc_nav, change_pct),
    )


def upsert_brief_event(conn: sqlite3.Connection, rec: dict) -> None:
    event = rec.get("event") or {}
    conn.execute(
        "INSERT OR REPLACE INTO brief_events(id, date, event_type, headline,"
        " explanation, risk, agent_mapping, decision, raw)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (rec.get("id"), rec.get("date"), event.get("type"), event.get("headline"),
         _j(rec.get("explanation")), _j(rec.get("risk")),
         _j(rec.get("agent_mapping")), _j(rec.get("decision")), _j(rec)),
    )


def upsert_brief(conn: sqlite3.Connection, date: str, title: str,
                 group_text: str, feishu_md: str, updated_at: str) -> None:
    conn.execute(
        "INSERT INTO briefs(date, title, group_text, feishu_md, updated_at)"
        " VALUES(?,?,?,?,?)"
        " ON CONFLICT(date) DO UPDATE SET title=excluded.title,"
        " group_text=excluded.group_text, feishu_md=excluded.feishu_md,"
        " updated_at=excluded.updated_at",
        (date, title, group_text, feishu_md, updated_at),
    )


def touch_ingest(conn: sqlite3.Connection, at: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES('last_ingest', ?)", (at,)
    )


# ------------------------------------------------------------ 读取（产品侧）

def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = ("quotes", "rates", "news", "earnings", "fund_nav", "fund_all",
              "brief_events", "briefs")
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in tables}


def latest_quotes(conn: sqlite3.Connection, date: str = "") -> list[dict]:
    """最新一日（或指定日）行情快照，供产品补全持仓价格。"""
    if not date:
        date = conn.execute("SELECT MAX(date) FROM quotes").fetchone()[0] or ""
    rows = conn.execute(
        "SELECT date, market, code, name, last, change, change_pct"
        " FROM quotes WHERE date = ? ORDER BY market, code", (date,)
    ).fetchall()
    return [dict(zip(("date", "market", "code", "name", "last", "change",
                      "change_pct"), r)) for r in rows]


def series_history(conn: sqlite3.Connection, series: str, days: int = 60) -> list[tuple]:
    """某利率序列最近 N 天（date, value, source）。"""
    return conn.execute(
        "SELECT date, value, source FROM rates WHERE series = ?"
        " ORDER BY date DESC LIMIT ?", (series, days)
    ).fetchall()
