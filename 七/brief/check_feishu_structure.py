# -*- coding: utf-8 -*-
"""飞书文档结构一致性检查

读取 rebuild 出的 txt（块清单），按日/周章节统计各模块出现次数，
标出重复（同一模块出现 >1 次）与缺失，作为清理前后的量化依据。

用法：
    python check_feishu_structure.py out/feishu_backup_full_2026-10-09.txt
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

MODULE_RE = re.compile(r"^\s*\[(?:text|bullet)\]\s*([①②③④⑤⑥⑦])\s")
FOOTER_RE = re.compile(r"^\s*\[(?:text|bullet)\]\s*数据留档")
HEADING_RE = re.compile(r"^\s*\[(heading[23])\]\s*(.+?)\s{2}<")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()

    sections: list[tuple[str, str, int, int]] = []
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m:
            sections.append((m.group(1), m.group(2).strip(), i, 0))
    for idx, (level, name, start, _) in enumerate(sections):
        end = sections[idx + 1][2] if idx + 1 < len(sections) else len(lines)
        sections[idx] = (level, name, start, end)

    print(f"sections: {len(sections)}")
    ok = True
    for level, name, start, end in sections:
        mods: list[str] = []
        n_footer = 0
        for line in lines[start:end]:
            m = MODULE_RE.match(line)
            if m:
                mods.append(m.group(1))
            if FOOTER_RE.match(line):
                n_footer += 1
        # heading2 = 容器章节（仅简介），不需要模块；heading3 = 内容章节，需 7 模块 + 1 留档
        if level == "heading2":
            print(f"\n[{name}]  (容器章节, 模块={len(mods)}, 留档 x{n_footer})")
            continue
        dup = [m for m in set(mods) if mods.count(m) > 1]
        missing = [m for m in "①②③④⑤⑥⑦" if m not in mods]
        flag = ""
        if dup or missing or n_footer != 1:
            ok = False
            flag = "  <== PROBLEM"
        print(f"\n[{name}]  modules={''.join(mods)}")
        print(f"    数据留档 x{n_footer}", end="")
        if dup:
            print(f"  重复模块: {dup}", end="")
        if missing:
            print(f"  缺失模块: {missing}", end="")
        print(flag)
    print("\nRESULT:", "OK" if ok else "INCONSISTENT")


if __name__ == "__main__":
    main()
