# -*- coding: utf-8 -*-
"""飞书文档块树重建工具（审计用）

把 `out/feishu_backup_tree_*.json`（由浏览器 _clientvarMap 导出的块数据）
重建成带层级与块类型的纯文本清单，用于：
1. 确认重复/残留段落的精确边界
2. 清理前后做 diff 验证

用法：
    python rebuild_feishu_tree.py out/feishu_backup_tree_2026-10-09.json
输出：同目录 同名 .txt
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def block_text(b: dict) -> str:
    """从块数据里取纯文本（initialAttributedTexts）。"""
    try:
        text_map = b["data"]["text"]["initialAttributedTexts"]["text"]
        return "".join(text_map[k] for k in sorted(text_map, key=int))
    except Exception:
        return ""


def rebuild(data: list[dict]) -> tuple[str, list[str]]:
    by_id = {b["id"]: b for b in data}
    root = None
    for b in data:
        if b["data"].get("type") == "page":
            root = b
            break
    if root is None:
        raise SystemExit("未找到 page 根块")
    lines: list[str] = []
    removed_dup: list[str] = []

    def emit(depth: int, kind: str, text: str, bid: str) -> None:
        pad = "  " * depth
        t = text.replace("\n", "⏎")
        lines.append(f"{pad}[{kind}] {t}  <{bid[:10]}>")

    def walk(bid: str, depth: int) -> None:
        b = by_id.get(bid)
        if b is None:
            lines.append("  " * depth + f"[missing] <{bid[:10]}>")
            return
        d = b["data"]
        t = d.get("type", "?")
        text = block_text(b)

        if t == "table":
            cols = d.get("columns_id", [])
            rows = d.get("rows_id", [])
            emit(depth, "table", f"{len(rows)}x{len(cols)}", bid)
            cell_set = d.get("cell_set", {})
            for r_i, r_id in enumerate(rows):
                cells = []
                for c_id in cols:
                    key = r_id + c_id
                    cell = cell_set.get(key)
                    if not cell:
                        cells.append("")
                        continue
                    cb = by_id.get(cell.get("block_id", ""))
                    # 单元格文本 = 单元格自身文本 + 其 children 的文本
                    inner = []
                    if cb:
                        inner.append(block_text(cb))
                        for ch in cb["data"].get("children", []):
                            chb = by_id.get(ch)
                            if chb:
                                inner.append(block_text(chb))
                    cells.append(" ".join(x.strip() for x in inner if x.strip()).strip())
                emit(depth + 1, f"row{r_i}", " | ".join(cells), r_id)
            return

        emit(depth, t, text, bid)
        for ch in d.get("children", []):
            walk(ch, depth + 1)

    walk(root["id"], 0)
    return "\n".join(lines), removed_dup


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    src = Path(sys.argv[1])
    data = json.loads(src.read_text(encoding="utf-8"))
    out, _ = rebuild(data)
    dst = src.with_suffix(".txt")
    dst.write_text(out, encoding="utf-8")
    print(f"blocks={len(data)}  lines={out.count(chr(10)) + 1}  -> {dst}")


if __name__ == "__main__":
    main()
