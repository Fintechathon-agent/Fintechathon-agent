# -*- coding: utf-8 -*-
"""汇报口述稿（2026-10-16）：Markdown → 打印版 HTML → PDF。

用法（仓库根目录）：python docs/make_report_2026-10-16.py
产物：docs/汇报口述稿_2026-10-16.html / .pdf
说明：只覆盖本稿用到的 Markdown 子集（标题/表格/列表/引用/加粗/行内代码/分隔线）。
"""
from __future__ import annotations

import html as html_mod
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DOCS = [
    (
        ROOT / "docs" / "汇报口述稿_2026-10-16.md",
        ROOT / "docs" / "汇报口述稿_2026-10-16.html",
        ROOT / "docs" / "汇报口述稿_2026-10-16.pdf",
        "金融 AI 安全任务台 · 汇报口述稿 2026-10-16",
    ),
    (
        ROOT / "docs" / "给队友口播稿_2026-10-16.md",
        ROOT / "docs" / "给队友口播稿_2026-10-16.html",
        ROOT / "docs" / "给队友口播稿_2026-10-16.pdf",
        "金融 AI 安全任务台 · 给队友口播稿 2026-10-16",
    ),
]

STYLE = """
:root {
  --ink: #2e2b27; --muted: #6f6a63; --paper: #ffffff; --line: #e5e1dc;
  --accent: #ed7627; --accent-wash: #fdf1e7; --wash: #f8f6f3;
}
* { box-sizing: border-box; }
@page { size: A4; margin: 16mm 15mm 18mm; }
html, body { margin: 0; padding: 0; background: var(--paper); }
body {
  font-family: "PingFang SC", "Microsoft YaHei", "HarmonyOS Sans", "MiSans", sans-serif;
  color: var(--ink); font-size: 10.5pt; line-height: 1.8; line-break: strict;
  -webkit-font-smoothing: antialiased;
}
h1 {
  font-size: 21pt; line-height: 1.35; margin: 0 0 6mm; letter-spacing: 0.02em;
}
h1::after {
  content: ""; display: block; width: 18mm; height: 1.4mm; margin-top: 4mm;
  background: var(--accent); border-radius: 1mm;
}
h2 {
  font-size: 14pt; margin: 9mm 0 3mm; padding-top: 3mm; page-break-after: avoid;
  border-top: 1px solid var(--line);
}
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; page-break-after: avoid; }
p { margin: 0 0 3mm; }
strong { color: #191612; }
blockquote {
  margin: 0 0 3mm; padding: 3mm 5mm; background: var(--accent-wash);
  border-left: 1.2mm solid var(--accent); border-radius: 1.5mm; color: #4c4038;
  font-size: 9.8pt;
}
blockquote p { margin: 0 0 1.5mm; }
blockquote p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px dashed var(--line); margin: 7mm 0; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1.2mm; }
table {
  width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.6pt;
  page-break-inside: auto;
}
th, td {
  border: 1px solid var(--line); padding: 2mm 3mm; text-align: left;
  vertical-align: top; line-height: 1.7;
}
th { background: var(--wash); font-weight: 600; white-space: nowrap; }
tr { page-break-inside: avoid; }
code {
  font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  font-size: 9pt; background: var(--wash); border-radius: 1mm; padding: 0 1mm;
  word-break: break-all;
}
.doc-meta {
  background: var(--wash); border: 1px solid var(--line); border-radius: 2mm;
  padding: 3.5mm 4.5mm; margin: 0 0 6mm; font-size: 9.8pt; color: var(--muted);
}
.doc-meta p { margin: 0 0 1mm; }
.doc-meta p:last-child { margin-bottom: 0; }
"""


def inline(text: str) -> str:
    """行内标记：先转义，再处理 `code` 与 **加粗**。"""
    out = html_mod.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    return out


def is_table_sep(line: str) -> bool:
    return bool(re.fullmatch(r"\|[\s:|-]+\|", line.strip()))


def split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def render(md_text: str) -> str:
    lines = md_text.splitlines()
    body: list[str] = []
    meta_buf: list[str] = []
    i = 0
    in_meta = False

    def flush_meta() -> None:
        nonlocal meta_buf
        if meta_buf:
            items = "".join(f"<p>{inline(x)}</p>" for x in meta_buf)
            body.append(f'<div class="doc-meta">{items}</div>')
            meta_buf = []

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # 文件头的引用块（> 开头）汇成 meta 卡
        if stripped.startswith(">"):
            in_meta = True
            meta_buf.append(stripped[1:].strip())
            i += 1
            continue
        if in_meta:
            flush_meta()
            in_meta = False

        if not stripped:
            i += 1
            continue
        if stripped == "---":
            body.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            body.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_table_sep(lines[i + 1]):
            header = split_row(stripped)
            rows: list[list[str]] = []
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            thead = "".join(f"<th>{inline(c)}</th>" for c in header)
            tbody = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows
            )
            body.append(f"<table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>")
            continue

        if re.match(r"^\d+\.\s", stripped):
            items: list[str] = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i].strip()))
                i += 1
            body.append("<ol>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
            continue

        if stripped.startswith("- "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            body.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>")
            continue

        body.append(f"<p>{inline(stripped)}</p>")
        i += 1

    if in_meta:
        flush_meta()
    return "\n".join(body)


def build_one(src: Path, out_html: Path, out_pdf: Path, title: str) -> None:
    md_text = src.read_text(encoding="utf-8")
    content = render(md_text)
    page = (
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n"
        f"<title>{html_mod.escape(title)}</title>\n<style>{STYLE}</style>\n</head>\n"
        f"<body>\n{content}\n</body>\n</html>\n"
    )
    out_html.write_text(page, encoding="utf-8")
    print(f"[ok] HTML: {out_html}  {len(page) // 1024} KB")

    from brief.make_brief_page import make_pdf  # noqa: PLC0415

    pdf = make_pdf(out_html, out_pdf, title)
    if pdf:
        print(f"[ok] PDF:  {pdf}  {pdf.stat().st_size // 1024} KB")
    else:
        print("[skip] PDF 导出失败（HTML 不受影响）")


def main() -> int:
    for src, out_html, out_pdf, title in DOCS:
        build_one(src, out_html, out_pdf, title)
    return 0


if __name__ == "__main__":
    sys.exit(main())
