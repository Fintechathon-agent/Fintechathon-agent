# -*- coding: utf-8 -*-
"""Daily Market Brief · 生成飞书文档章节文件

从 out/brief_YYYY-MM-DD.md 提取「### 日期」起的内容（去掉文件头的 H1 与说明），
写入 out/feishu_section_YYYY-MM-DD.md，供浏览器粘贴（push_brief_section.ps1）或 API 上传使用。

用法：
    python brief/make_feishu_section.py                # 默认取当天日期
    python brief/make_feishu_section.py 2026-10-08     # 指定日期
    python brief/make_feishu_section.py path/to/brief_x.md
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg is None:
        src = OUT / f"brief_{date.today():%Y-%m-%d}.md"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", arg):
        src = OUT / f"brief_{arg}.md"
    else:
        src = Path(arg)

    if not src.exists():
        print(f"[error] 找不到草稿：{src}")
        return 2

    md = src.read_text(encoding="utf-8")
    m = re.search(r"^### ", md, flags=re.M)
    if not m:
        print(f"[error] {src} 中没有 '### 日期' 章节标题，无法提取")
        return 2

    section = md[m.start():].strip() + "\n"
    dm = re.search(r"\d{4}-\d{2}-\d{2}", section[:60])
    name = dm.group(0) if dm else src.stem.replace("brief_", "")
    dst = OUT / f"feishu_section_{name}.md"
    dst.write_text(section, encoding="utf-8")

    warn = "（含【待填】，需先补齐）" if "【待填】" in section else ""
    print(f"[ok] 章节已生成：{dst}（{len(section)} 字）{warn}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
