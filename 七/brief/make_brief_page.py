# -*- coding: utf-8 -*-
"""Daily Market Brief · 网页版日报生成

把 out/brief_YYYY-MM-DD.md（七模块版草稿）渲染成单文件 HTML：
    out/brief_YYYY-MM-DD.html —— 内联样式、无外部依赖，可直接打开 / 转发 / 打印。
    out/index.html            —— 入口页：全部期数倒序、最新置顶（每次运行自动重建）。
    out/latest.html           —— 固定链接：永远指向最新一期（每次运行自动同步）。
    out/share/每日市场简报_日期.html —— 转发副本：文件名即标题，页面内无跨文件链接，
                                      单独把这一个文件发给任何人都能打开（微信/邮件均可）。

版式参考 memene.cn/daily 的编辑式视觉语言：奶油色 Hero 卡、衬线大标题、
蓝色 kicker 小标签、左侧编号目录、克制的留白。金融改写：红涨绿跌、数据表化。

用法：
    python brief/make_brief_page.py                  # 处理当天，并重建入口页
    python brief/make_brief_page.py --date 2026-10-07
    python brief/make_brief_page.py --file out/brief_2026-10-07.md
    python brief/make_brief_page.py --no-index       # 只出当期，不动入口页
"""
from __future__ import annotations

import argparse
import html
import os
import re
import shutil
import subprocess
import time
import urllib.parse
from datetime import date
from pathlib import Path
from string import Template

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

# 模块序号 → (英文 kicker, 目录名)。与 make_brief_draft.py 的七模块顺序一致。
SECTION_META = {
    "①": ("MARKET", "市场行情"),
    "②": ("MOVERS", "异常波动"),
    "③": ("EARNINGS", "重要财报"),
    "④": ("NEWS", "重大新闻"),
    "⑤": ("EXPLAIN", "一句解释"),
    "⑥": ("MAPPING", "Agent 映射"),
    "⑦": ("QUESTION", "今日问题"),
}

CSS = """
:root {
  --bg: #FBFAF8;
  --card: #FFFFFF;
  --hero-bg: #F1EDE4;
  --hero-tab: #F7F3EA;
  --ink: #141413;
  --text: #333331;
  --text-2: #7A7A76;
  --border: #E7E4DD;
  --hair: #EFEDE8;
  --primary: #2563EB;
  --accent: #1E3A5F;
  --up: #B4453A;
  --down: #2D6A4F;
  --code-bg: #F0EEE7;
  --note-bg: #F7F5EF;
  --serif: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif;
  --sans: "PingFang SC", "MiSans", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514;
    --card: #1D1D1B;
    --hero-bg: #221F1A;
    --hero-tab: #2A2620;
    --ink: #ECEAE4;
    --text: #CFCDC7;
    --text-2: #8E8C86;
    --border: #2E2D2A;
    --hair: #262522;
    --primary: #8AB0FF;
    --accent: #A9C3E8;
    --up: #DE857C;
    --down: #7FBF9E;
    --code-bg: #262623;
    --note-bg: #201F1C;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 16px/1.75 var(--sans);
  -webkit-font-smoothing: antialiased;
}
.wrap {
  max-width: 1000px;
  margin: 0 auto;
  padding: 56px 28px 88px;
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 64px;
  align-items: start;
}
/* ---------- 左侧目录 ---------- */
.rail { position: sticky; top: 48px; }
.rail-title {
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--text-2); margin: 0 0 12px 14px;
}
.rail a {
  display: flex; gap: 10px; align-items: baseline;
  padding: 7px 0 7px 14px;
  border-left: 2px solid transparent;
  color: var(--text-2); text-decoration: none;
  font-size: 13.5px; line-height: 1.5;
  transition: color .15s ease, border-color .15s ease;
}
.rail a .n { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-2); }
.rail a:hover,
.rail a.on { color: var(--ink); border-left-color: var(--primary); }
.rail a.on .n { color: var(--primary); }
/* ---------- Hero ---------- */
.hero {
  position: relative;
  background: var(--hero-bg);
  border-radius: 20px;
  padding: 30px 34px 26px;
  box-shadow: 0 1px 2px rgba(20,20,19,.04), 0 10px 32px rgba(20,20,19,.05);
}
.hero::before {
  content: "";
  position: absolute; top: -9px; left: -9px; width: 150px; height: 46px;
  background: var(--hero-tab); border-radius: 14px; z-index: 0;
}
.hero > * { position: relative; z-index: 1; }
.hero-bar {
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  margin-bottom: 12px;
}
.kicker {
  font-size: 11px; font-weight: 600; letter-spacing: .14em;
  text-transform: uppercase; color: var(--primary);
}
.hero-read { font-size: 12.5px; color: var(--text-2); white-space: nowrap; }
.hero h1 {
  margin: 4px 0 10px;
  font-family: var(--serif); font-weight: 800;
  font-size: clamp(34px, 5vw, 46px); line-height: 1.15; letter-spacing: .01em;
  color: var(--ink);
}
.hero-sub { margin: 0; font-size: 14px; color: var(--text-2); }
.hero-foot {
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid rgba(20,20,19,.08);
  font-size: 12.5px; color: var(--text-2);
}
.hero-foot a { color: var(--primary); text-decoration: none; }
.hero-foot a:hover { text-decoration: underline; }
@media (prefers-color-scheme: dark) {
  .hero-foot { border-top-color: rgba(236,234,228,.1); }
}
/* ---------- 区块 ---------- */
.sec { margin-top: 64px; }
.sec h2 {
  margin: 8px 0 22px;
  font-family: var(--serif); font-weight: 700;
  font-size: 27px; line-height: 1.3; letter-spacing: .01em; color: var(--ink);
}
/* ---------- 表格 ---------- */
.tbl-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px 8px;
  overflow-x: auto;
}
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.tbl th {
  text-align: left; font-weight: 500; font-size: 12.5px; color: var(--text-2);
  padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.tbl td { padding: 11px 12px; border-bottom: 1px solid var(--hair); vertical-align: top; }
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl .asset { font-weight: 600; color: var(--ink); white-space: nowrap; }
.tbl .val { color: var(--text); white-space: nowrap; }
.tbl .chg { font-weight: 600; white-space: nowrap; }
.tbl .up { color: var(--up); }
.tbl .dn { color: var(--down); }
.tbl .fl { color: var(--text-2); font-weight: 400; }
.tbl .when { color: var(--text-2); font-size: 13px; }
.mapping .l2 { white-space: nowrap; }
.mapping .l2 code, .mapping .l3 code { white-space: nowrap; }
/* ---------- 提示块 ---------- */
.note {
  margin: 16px 0 0;
  background: var(--note-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 18px;
  font-size: 14px; line-height: 1.8; color: var(--text);
}
.note strong { color: var(--accent); font-weight: 600; }
/* ---------- 异常波动 ---------- */
.moves { list-style: none; margin: 0; padding: 0; }
.moves li { padding: 18px 0; border-bottom: 1px solid var(--hair); }
.moves li:last-child { border-bottom: 0; }
.mv-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.mv-name { font-size: 15px; font-weight: 600; color: var(--ink); }
.mv-pct { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
.mv-pct.up { color: var(--up); }
.mv-pct.dn { color: var(--down); }
.mv-note { margin-top: 5px; font-size: 13.5px; line-height: 1.7; color: var(--text-2); }
/* ---------- 财报 ---------- */
.earn { margin: 0; padding: 0; }
.earn-item { padding: 16px 0; border-bottom: 1px solid var(--hair); }
.earn-item:last-child { border-bottom: 0; }
.earn-item > p {
  margin: 0; font-family: var(--serif);
  font-size: 15.5px; line-height: 1.85; color: var(--text);
}
.earn-item > p::before {
  content: ""; display: inline-block;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--primary); margin: 0 12px 3px 2px;
}
.earn .sub { list-style: none; margin: 10px 0 0; padding: 0 0 0 19px; }
.earn .sub li {
  position: relative; padding: 4px 0 4px 14px;
  font-size: 13.5px; line-height: 1.8; color: var(--text-2);
}
.earn .sub li::before {
  content: ""; position: absolute; left: 0; top: 15px;
  width: 7px; height: 1px; background: var(--text-2);
}
/* ---------- 新闻 ---------- */
.news { list-style: none; margin: 0; padding: 0; }
.news li { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--hair); }
.news li:last-child { border-bottom: 0; }
.news .num {
  flex: none; width: 24px; padding-top: 5px;
  font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-2);
}
.news .txt { margin: 0; font-family: var(--serif); font-size: 15.5px; line-height: 1.85; }
/* ---------- 一句解释 ---------- */
.explain p {
  margin: 0 0 20px; font-family: var(--serif);
  font-size: 16px; line-height: 1.95; color: var(--text);
}
.explain p:last-child { margin-bottom: 0; }
.explain strong, .news strong, .earn strong, .q-lead strong { color: var(--accent); font-weight: 600; }
/* ---------- 今日问题 ---------- */
.q-lead { margin: 0 0 10px; font-family: var(--serif); font-size: 16px; line-height: 1.95; }
.q-lead:last-of-type { margin-bottom: 20px; }
.opts { display: grid; gap: 12px; margin: 0 0 20px; }
.opt {
  display: flex; gap: 14px; align-items: flex-start;
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 13px 16px;
}
.opt .k {
  flex: none; width: 26px; height: 26px; margin-top: 1px;
  display: grid; place-items: center;
  background: var(--note-bg); border-radius: 8px;
  font-size: 13px; font-weight: 700; color: var(--accent);
}
.opt p { margin: 0; font-size: 14.5px; line-height: 1.7; }
.why {
  background: var(--note-bg); border: 1px solid var(--border); border-radius: 12px;
  padding: 14px 18px; font-size: 14px; line-height: 1.8;
}
.why b { color: var(--accent); font-weight: 600; }
.why code, code {
  font-family: var(--mono); font-size: 12.5px;
  background: var(--code-bg); border-radius: 6px; padding: 1px 6px; color: #3A3A38;
}
@media (prefers-color-scheme: dark) { .why code, code { color: #C9C7C2; } }
/* ---------- 页脚 ---------- */
.foot {
  margin-top: 72px; padding-top: 22px;
  border-top: 1px solid var(--border);
  font-size: 12.5px; line-height: 1.8; color: var(--text-2);
}
.foot p { margin: 0 0 6px; }
/* ---------- 响应式 ---------- */
@media (max-width: 1023px) {
  .wrap { grid-template-columns: minmax(0, 1fr); max-width: 720px; padding: 36px 20px 64px; }
  .rail { display: none; }
  .sec { margin-top: 52px; }
  .hero { padding: 24px 22px 22px; }
  .tbl { min-width: 560px; }
}
@page { size: A4; margin: 14mm 12mm; }
@media print {
  /* 打印/导出 PDF 一律锁定浅色：深色模式偏好会把变量染成浅字，落纸即不可读 */
  :root {
    --bg: #FBFAF8; --card: #FFFFFF; --hero-bg: #F1EDE4; --hero-tab: #F7F3EA;
    --ink: #141413; --text: #333331; --text-2: #7A7A76;
    --border: #E7E4DD; --hair: #EFEDE8;
    --primary: #2563EB; --accent: #1E3A5F;
    --up: #B4453A; --down: #2D6A4F;
    --code-bg: #F0EEE7; --note-bg: #F7F5EF;
  }
  .rail { display: none; }
  .wrap { display: block; max-width: none; padding: 0; }
  body { background: #fff; }
  .hero { box-shadow: none; border: 1px solid var(--border); }
  .moves li, .news li, .earn-item, .opt { break-inside: avoid; }
  /* 模块标题不单独落在页脚：标题+首个内容块至少同页可见 */
  .sec { break-inside: auto; }
  .sec > .kicker, .sec > h2 { break-after: avoid; }
  /* 今日问题：题干与 A/B/C 选项必须同页，避免拆读 */
  #s7 { break-inside: avoid; }
  h2 { break-after: avoid; }
  .tbl-card { break-inside: auto; }
  .tbl thead { display: table-header-group; }
  .tbl tr { break-inside: avoid; }
  .note, .why, .opts { break-inside: avoid; }
  .sec { margin-top: 40px; }
  .foot { margin-top: 40px; }
}
"""

PAGE = Template("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title</title>
<link rel="icon" href="data:,">
<style>$css</style>
</head>
<body>
<div class="wrap">
  <aside class="rail" aria-label="目录">
    <p class="rail-title">目录 · Contents</p>
    $rail
  </aside>
  <main>
    <header class="hero">
      <div class="hero-bar">
        <span class="kicker">Daily Briefing · $date_slash</span>
        <span class="hero-read">约 $read_min 分钟阅读 · $quote_count 项行情</span>
      </div>
      <h1>每日市场简报</h1>
      <p class="hero-sub">$date_line</p>
      <p class="hero-foot">Personal AI Fund Manager · 每日 18:00 发布 · 数据经双源核验</p>
    </header>
$sections
    <footer class="foot">
      <p>$footer</p>
      <p>仅为信息整理，不构成投资建议。</p>
    </footer>
  </main>
</div>
<script>
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.rail a'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byHref = {};
  links.forEach(function (a) { byHref[a.getAttribute('href')] = a; });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('on'); });
      var a = byHref['#' + e.target.id];
      if (a) a.classList.add('on');
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('main .sec').forEach(function (s) { io.observe(s); });
})();
</script>
</body>
</html>
""")

SINGLE_STAR = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
SECTION_RE = re.compile(r"^\*\*([①②③④⑤⑥⑦])\s*(.+?)\*\*\s*$")
BULLET_RE = re.compile(r"^(\s*)[-*]\s+(.*)$")
TABLE_SEP = re.compile(r":?-{2,}:?")
OPTION_RE = re.compile(r"^([ABC])[.、]\s*(.*)$")


def inline(text: str) -> str:
    """行内 Markdown → HTML：**加粗**、`代码`、去单星号（中文不用斜体）。"""
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = SINGLE_STAR.sub(r"\1", t)
    return t


def parse_blocks(lines: list[str]) -> list[tuple]:
    """把一段 Markdown 行解析成块：table / quote / list / para。"""
    blocks: list[tuple] = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(TABLE_SEP.fullmatch(c) for c in cells if c):
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows))
            continue
        if s.startswith(">"):
            quote = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip("> ").strip())
                i += 1
            blocks.append(("quote", " ".join(quote)))
            continue
        m = BULLET_RE.match(line)
        if m:
            items = []
            while i < n:
                mm = BULLET_RE.match(lines[i])
                if mm:
                    items.append((len(mm.group(1)), mm.group(2)))
                    i += 1
                elif not lines[i].strip():
                    nxt = lines[i + 1] if i + 1 < n else ""
                    if BULLET_RE.match(nxt):
                        i += 1
                        continue
                    break
                else:
                    break
            blocks.append(("list", items))
            continue
        para = [s]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if (not nxt or nxt.startswith("|") or nxt.startswith(">")
                    or nxt.startswith("**") or BULLET_RE.match(lines[i])
                    or OPTION_RE.match(nxt)):
                break
            para.append(nxt)
            i += 1
        blocks.append(("para", " ".join(para)))
    return blocks


def pct_class(value: str) -> str:
    if value.startswith("+"):
        return "up"
    if value.startswith("-"):
        return "dn"
    return "fl"


def render_table(rows: list[list[str]], kind: str = "") -> str:
    if not rows:
        return ""
    head, body = rows[0], rows[1:]
    out = [f'<div class="tbl-card"><table class="tbl {kind}"><thead><tr>']
    for c in head:
        out.append(f"<th>{inline(c)}</th>")
    out.append("</tr></thead><tbody>")
    for r in body:
        out.append("<tr>")
        if kind == "mapping":
            out.append(f'<td class="asset l1">{inline(r[0] if r else "")}</td>')
            out.append(f'<td class="l2">{inline(r[1] if len(r) > 1 else "")}</td>')
            out.append(f'<td class="l3">{inline(r[2] if len(r) > 2 else "")}</td>')
        else:
            chg = r[2] if len(r) > 2 else ""
            out.append(f'<td class="asset">{inline(r[0] if r else "")}</td>')
            out.append(f'<td class="val">{inline(r[1] if len(r) > 1 else "")}</td>')
            out.append(f'<td class="chg {pct_class(chg)}">{inline(chg)}</td>')
            out.append(f'<td class="when">{inline(r[3] if len(r) > 3 else "")}</td>')
        out.append("</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


MV_RE = re.compile(
    r"^(?P<name>[^：:]+)[：:]\s*(?P<pct>[+-]?\d+(?:\.\d+)?%)"
    r"(?:（最新\s*(?P<last>[^）]+)）)?\s*(?:——|—|--)?\s*(?P<note>.*)$"
)


def render_moves(items: list[tuple]) -> str:
    out = ['<ul class="moves">']
    for _, text in items:
        m = MV_RE.match(text)
        if m:
            pct = m.group("pct")
            last = m.group("last")
            note = m.group("note").strip()
            if last:
                note = f"最新 {last}" + (f" · {note}" if note else "")
            out.append(
                f'<li><div class="mv-row"><span class="mv-name">{inline(m.group("name"))}</span>'
                f'<span class="mv-pct {pct_class(pct)}">{inline(pct)}</span></div>'
                f'<div class="mv-note">{inline(note)}</div></li>'
            )
        else:
            out.append(f'<li><div class="mv-note">{inline(text)}</div></li>')
    out.append("</ul>")
    return "".join(out)


def render_earn(items: list[tuple]) -> str:
    out = ['<div class="earn">']
    sub_open = False
    item_open = False

    def close_sub():
        nonlocal sub_open
        if sub_open:
            out.append("</ul>")
            sub_open = False

    def close_item():
        nonlocal item_open
        close_sub()
        if item_open:
            out.append("</div>")
            item_open = False

    for indent, text in items:
        if indent == 0:
            close_item()
            out.append(f'<div class="earn-item"><p>{inline(text)}</p>')
            item_open = True
        else:
            if not item_open:
                out.append('<div class="earn-item">')
                item_open = True
            if not sub_open:
                out.append('<ul class="sub">')
                sub_open = True
            out.append(f"<li>{inline(text)}</li>")
    close_item()
    out.append("</div>")
    return "".join(out)


def render_news(items: list[tuple]) -> str:
    out = ['<ol class="news">']
    for n, (_, text) in enumerate(items, 1):
        out.append(f'<li><span class="num">{n:02d}</span><p class="txt">{inline(text)}</p></li>')
    out.append("</ol>")
    return "".join(out)


def render_explain(items: list[tuple]) -> str:
    return '<div class="explain">' + "".join(f"<p>{inline(t)}</p>" for _, t in items) + "</div>"


def render_question(blocks: list[tuple]) -> str:
    lead, opts, why = [], [], []
    for kind, payload in blocks:
        if kind == "para":
            m = OPTION_RE.match(payload)
            if m:
                opts.append((m.group(1), m.group(2)))
                continue
            if payload.startswith("为什么"):
                body = re.sub(r"^为什么？\s*", "", payload)
                why.append(body)
                continue
            lead.append(payload)
        elif kind == "list":
            for _, t in payload:
                m = OPTION_RE.match(t)
                if m:
                    opts.append((m.group(1), m.group(2)))
                elif t.startswith("为什么"):
                    why.append(re.sub(r"^为什么？\s*", "", t))
                else:
                    lead.append(t)
    out = []
    for p in lead:
        out.append(f'<p class="q-lead">{inline(p)}</p>')
    if opts:
        out.append('<div class="opts">')
        for k, t in opts:
            out.append(f'<div class="opt"><span class="k">{k}</span><p>{inline(t)}</p></div>')
        out.append("</div>")
    if why:
        out.append(f'<div class="why"><b>为什么？</b> {inline(" ".join(why))}</div>')
    return "".join(out)


def render_section(index: int, sections: list[tuple]) -> str:
    key, title, lines = sections[index]
    en, cn = SECTION_META.get(key, ("", title))
    blocks = parse_blocks(lines)
    body = []
    quote_blocks = [p for k, p in blocks if k == "quote"]
    for kind, payload in blocks:
        if kind == "table":
            body.append(render_table(payload, "mapping" if key == "⑥" else "market"))
        elif kind == "list":
            if key == "②":
                body.append(render_moves(payload))
            elif key == "③":
                body.append(render_earn(payload))
            elif key == "④":
                body.append(render_news(payload))
            elif key == "⑤":
                body.append(render_explain(payload))
            else:
                body.append("<p>" + "</p><p>".join(inline(t) for _, t in payload) + "</p>")
        elif kind == "para":
            if key == "⑦":
                continue  # 由 render_question 统一处理
            body.append(f'<p class="q-lead">{inline(payload)}</p>')
        elif kind == "quote":
            body.append(f'<div class="note">{inline(payload)}</div>')
    if key == "⑦":
        body = [render_question(blocks)]
    return (
        f'<section class="sec" id="s{index + 1}">'
        f'<div class="kicker">{index + 1:02d} · {en}</div>'
        f"<h2>{cn}</h2>" + "".join(body) + "</section>"
    )


def split_document(md: str):
    """拆出日期行、七个模块与页脚。返回 (date_line, sections, footer)。"""
    date_line = ""
    sections: list[tuple] = []
    footer: list[str] = []
    current = None
    for raw in md.splitlines():
        line = raw.rstrip()
        m = re.match(r"^###\s+(.+)$", line)
        if m and not date_line:
            date_line = m.group(1).strip()
            continue
        m = SECTION_RE.match(line.strip())
        if m:
            current = (m.group(1), m.group(2).strip(), [])
            sections.append(current)
            continue
        if line.strip().startswith("*数据留档"):
            footer.append(line.strip().strip("*"))
            current = None
            continue
        if current is not None:
            current[2].append(line)
        elif footer:
            footer.append(line.strip())
    return date_line, sections, " ".join(footer)


def build(md: str, source_name: str) -> str:
    date_line, sections, footer = split_document(md)
    if not sections:
        raise SystemExit("[error] 未在 Markdown 中找到「**① 市场行情**」等模块标记，无法生成页面")
    dm = re.search(r"\d{4}-\d{2}-\d{2}", date_line or source_name)
    date_iso = dm.group(0) if dm else date.today().isoformat()
    date_slash = date_iso.replace("-", "/")
    if not date_line:
        date_line = date_iso

    market_rows = 0
    for key, _, lines in sections:
        if key == "①":
            for kind, payload in parse_blocks(lines):
                if kind == "table":
                    market_rows = max(market_rows, len(payload) - 1)
    read_min = max(3, round(len(md) / 380))

    rail = "".join(
        f'<a href="#s{i + 1}"><span class="n">{i + 1:02d}</span><span>{SECTION_META.get(k, ("", t))[1]}</span></a>'
        for i, (k, t, _) in enumerate(sections)
    )
    body = "".join(render_section(i, sections) for i in range(len(sections)))

    return PAGE.substitute(
        title=f"每日市场简报 · {date_iso}",
        css=CSS,
        rail=rail,
        date_slash=date_slash,
        date_line=date_line,
        read_min=read_min,
        quote_count=market_rows,
        sections=body,
        footer=inline(footer) if footer else "数据留档见 brief/out/。",
    )


# ---------------- 入口页（全部期数 / 固定链接） ----------------

INDEX_CSS = """
.wrap.idx { grid-template-columns: minmax(0, 1fr); max-width: 780px; }
.idx-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
.idx-list li { border-bottom: 1px solid var(--hair); }
.idx-list a {
  display: grid; grid-template-columns: 104px minmax(0, 1fr) auto;
  gap: 18px; align-items: baseline;
  padding: 18px 8px; text-decoration: none; color: inherit;
  border-radius: 10px; transition: background .15s ease;
}
.idx-list a:hover { background: var(--card); }
.idx-date {
  font-family: var(--mono); font-size: 13px; color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.idx-teaser {
  font-family: var(--serif); font-size: 15.5px; line-height: 1.65; color: var(--ink);
}
.idx-meta { font-size: 12.5px; color: var(--text-2); white-space: nowrap; text-align: right; }
.idx-list .now .idx-date { color: var(--primary); font-weight: 600; }
.idx-badge {
  display: inline-block; margin-left: 8px; padding: 1px 7px;
  background: var(--primary); color: #FFFFFF; border-radius: 999px;
  font-size: 10.5px; letter-spacing: .06em; vertical-align: 1.5px;
}
.idx-draft { color: var(--text-2); }
@media (max-width: 640px) {
  .idx-list a { grid-template-columns: minmax(0, 1fr); gap: 3px; padding: 16px 4px; }
  .idx-meta { display: none; }
}
"""

INDEX_PAGE = Template("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>每日市场简报 · 全部期数</title>
<link rel="icon" href="data:,">
<style>$css</style>
</head>
<body>
<div class="wrap idx">
  <main>
    <header class="hero">
      <div class="hero-bar">
        <span class="kicker">Daily Briefing · Archive</span>
        <span class="hero-read">共 $count 期</span>
      </div>
      <h1>每日市场简报</h1>
      <p class="hero-sub">Personal AI Fund Manager · 每个交易日 18:00 自动发布</p>
      <p class="hero-foot">最新一期 <a href="$latest_file">$latest_date</a> · 固定链接 <a href="latest.html">latest.html</a> · 更新于 $updated</p>
    </header>
    <section class="sec">
      <h2>全部期数</h2>
      <ul class="idx-list">
$items
      </ul>
    </section>
    <footer class="foot">
      <p>数据留档见 brief/out/。标「草稿」的期次仍含【待填】，补齐后重新生成即转为正式稿。</p>
      <p>仅为信息整理，不构成投资建议。</p>
    </footer>
  </main>
</div>
</body>
</html>
""")


def _plain(s: str) -> str:
    """去掉行内 Markdown 标记，得到纯文本摘要。"""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = SINGLE_STAR.sub(r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    return s.strip()


def teaser_of(md: str) -> str:
    """抓「② 异常波动」首条作为摘要，退化到「④ 重大新闻」。"""
    for want in ("②", "④"):
        collecting = False
        for raw in md.splitlines():
            line = raw.strip()
            m = SECTION_RE.match(line)
            if m:
                collecting = m.group(1) == want
                continue
            if collecting and BULLET_RE.match(line):
                text = BULLET_RE.match(line).group(2)
                text = re.split(r"——|—|；", _plain(text))[0].strip()
                return text[:46] + ("…" if len(text) > 46 else "")
    return ""


def write_index() -> tuple[Path, Path, int, str]:
    """重建 out/index.html（全部期数，倒序）并把最新一期复制为 out/latest.html。"""
    entries = []
    for md_path in sorted(OUT.glob("brief_*.md")):
        dm = re.search(r"\d{4}-\d{2}-\d{2}", md_path.stem)
        if not dm:
            continue
        html_path = md_path.with_suffix(".html")
        if not html_path.exists():
            continue
        md = md_path.read_text(encoding="utf-8")
        date_iso = dm.group(0)
        draft = "【待填】" in md
        n_sec = len(re.findall(r"^\*\*[①-⑦]", md, re.M))
        meta = "草稿" if draft else f"{n_sec} 模块 · 约 {max(3, round(len(md) / 380))} 分钟"
        entries.append(
            {
                "date": date_iso,
                "file": html_path.name,
                "teaser": teaser_of(md) or "（今日无异常波动条目）",
                "meta": meta,
                "draft": draft,
            }
        )
    if not entries:
        raise SystemExit("[error] out/ 下没有找到已生成 HTML 的 brief_日期.md，无法建立入口页")
    entries.sort(key=lambda e: e["date"], reverse=True)

    items = []
    for i, e in enumerate(entries):
        cls = ' class="now"' if i == 0 else ""
        badge = '<span class="idx-badge">最新</span>' if i == 0 else ""
        draft_tag = ' <span class="idx-draft">· 草稿</span>' if e["draft"] else ""
        items.append(
            f'        <li{cls}><a href="{html.escape(e["file"])}">'
            f'<span class="idx-date">{e["date"]}</span>'
            f'<span class="idx-teaser">{html.escape(e["teaser"])}{badge}</span>'
            f'<span class="idx-meta">{e["meta"]}{draft_tag}</span>'
            f"</a></li>"
        )

    from datetime import datetime

    page = INDEX_PAGE.substitute(
        css=CSS + INDEX_CSS,
        count=len(entries),
        items="\n".join(items),
        latest_file=entries[0]["file"],
        latest_date=entries[0]["date"],
        updated=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    index_path = OUT / "index.html"
    index_path.write_text(page, encoding="utf-8")
    latest_path = OUT / "latest.html"
    latest_path.write_bytes((OUT / entries[0]["file"]).read_bytes())

    # 转发副本：文件名即标题，对方收到后双击就开（单文件、零依赖、页面内无外链）
    top = entries[0]
    share_path = None
    if not top["draft"]:
        share_dir = OUT / "share"
        share_dir.mkdir(exist_ok=True)
        share_path = share_dir / f"每日市场简报_{top['date']}.html"
        share_path.write_bytes((OUT / top["file"]).read_bytes())
    return index_path, latest_path, len(entries), top["date"], share_path


def _find_browser() -> str | None:
    """定位可用于导 PDF 的 Chromium 系浏览器；找不到返回 None（不阻断主流程）。"""
    names = ("chrome", "chrome.exe", "msedge", "msedge.exe")
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for p in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ):
        if Path(p).exists():
            return p
    return None


def _stamp_pdf_metadata(pdf_path: Path, title: str, retries: int = 6) -> None:
    """补全 PDF 元数据（标题/作者/主题）。pymupdf 不可用时静默跳过，不影响导出。

    写临时文件再替换：Chrome 刚写完 PDF 时仍可能持有句柄，Windows 下原地增量
    保存会被拒（Permission denied），故带重试。失败不阻断主流程。
    """
    try:
        import pymupdf
    except ImportError:
        return
    for _ in range(retries):
        doc = None
        tmp = pdf_path.with_suffix(".pdf.tmp")
        try:
            doc = pymupdf.open(pdf_path)
            meta = doc.metadata or {}
            meta["title"] = title
            meta["author"] = "Personal AI Fund Manager"
            meta["subject"] = "每日市场简报 · Daily Market Brief"
            doc.set_metadata(meta)
            doc.save(tmp)
            doc.close()
            doc = None
            os.replace(tmp, pdf_path)
            return
        except Exception:
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    pass
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            time.sleep(0.8)


def make_pdf(html_path: Path, pdf_path: Path, title: str = "") -> Path | None:
    """用无头浏览器把页面导成 PDF（手机/打印场景最通用的形态）。失败则返回 None。"""
    browser = _find_browser()
    if not browser:
        print("[skip] 未找到 Chrome/Edge，跳过 PDF 导出（HTML 不受影响）")
        return None
    url = "file:///" + urllib.parse.quote(html_path.resolve().as_posix())
    profile = Path(os.environ.get("TEMP") or os.environ.get("TMPDIR") or "/tmp") / "brief-pdf-profile"
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        f"--user-data-dir={profile}",
        f"--print-to-pdf={pdf_path.resolve()}",
        url,
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=120, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"[skip] PDF 导出失败（{type(exc).__name__}），HTML 不受影响")
        return None
    if pdf_path.exists() and pdf_path.stat().st_size > 0:
        if title:
            _stamp_pdf_metadata(pdf_path, title)
        return pdf_path
    print("[skip] PDF 导出未产出文件，HTML 不受影响")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily Market Brief 网页版生成")
    parser.add_argument("--date", help="日期（默认当天），读取 out/brief_日期.md")
    parser.add_argument("--file", help="指定 Markdown 文件（默认 out/brief_日期.md）")
    parser.add_argument("--no-index", action="store_true", help="只生成当期页面，不重建入口页")
    parser.add_argument("--no-pdf", action="store_true", help="跳过 PDF 导出（默认随转发副本一起生成）")
    args = parser.parse_args()

    if args.file:
        src = Path(args.file)
        if not src.is_absolute():
            src = (Path.cwd() / src).resolve() if (Path.cwd() / src).exists() else (OUT / Path(args.file).name)
    else:
        day = args.date or date.today().isoformat()
        src = OUT / f"brief_{day}.md"
    if not src.exists():
        print(f"[error] 找不到草稿：{src}")
        return 2

    md = src.read_text(encoding="utf-8")
    page = build(md, src.name)
    dst = OUT / (src.stem + ".html")
    dst.write_text(page, encoding="utf-8")
    note = "（仍含【待填】，先补齐再发布）" if "【待填】" in md else ""
    print(f"[ok] 网页版已生成：{dst}{note}")

    if not args.no_index:
        index_path, latest_path, count, top_date, share_path = write_index()
        print(f"[ok] 入口页已重建：{index_path}（{count} 期）")
        print(f"[ok] 固定链接已指向 {top_date}：{latest_path}")
        if share_path:
            print(f"[ok] 转发副本（发人就发这个）：{share_path}")
            if not args.no_pdf:
                pdf_path = share_path.with_suffix(".pdf")
                if make_pdf(share_path, pdf_path, f"每日市场简报 · {top_date}"):
                    size_kb = pdf_path.stat().st_size / 1024
                    print(f"[ok] 转发 PDF（手机/打印更通用）：{pdf_path}（{size_kb:.0f} KB）")
        else:
            print("[skip] 最新一期仍含【待填】，未生成转发副本（补齐后重跑即可）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
