# -*- coding: utf-8 -*-
"""今晚汇报 PDF 渲染：HTML → 无头浏览器打印 → 元数据/页码 → PNG 预览。

用法（仓库根目录）：python docs/make_report_pdf.py
产物：docs/今晚汇报_2026-10-12.pdf + 预览 PNG 到临时目录（路径打印在末尾）。
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

HTML = ROOT / "docs" / "今晚汇报_2026-10-12.html"
PDF = ROOT / "docs" / "今晚汇报_2026-10-12.pdf"
TITLE = "金融 AI 安全任务台 · 今晚汇报 2026-10-12"
AUTHOR = "金怡含（七七）· Finance Lab"
SUBJECT = "Fintechathon 2026 团队进度汇报"


def load_make_pdf():
    mod_path = ROOT / "brief" / "make_brief_page.py"
    try:
        from brief.make_brief_page import make_pdf  # noqa
        return make_pdf
    except ImportError:
        spec = importlib.util.spec_from_file_location("make_brief_page", mod_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.make_pdf


def kill_profile_leftovers():
    """清掉占用简报 PDF profile 的残留无头 Chrome，避免二次渲染锁死超时。"""
    try:
        subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*brief-pdf-profile*' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
            ],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def render_with_retries(make_pdf) -> bool:
    for attempt in range(3):
        kill_profile_leftovers()
        try:
            make_pdf(HTML, PDF, "")
        except Exception:
            pass
        if PDF.exists() and PDF.stat().st_size > 0:
            return True
        time.sleep(2)
    return False


def main() -> int:
    make_pdf = load_make_pdf()
    if not render_with_retries(make_pdf):
        print("[失败] 无头浏览器导出未产出 PDF（HTML 不受影响）")
        return 1

    import fitz  # PyMuPDF

    doc = fitz.open(PDF)
    meta = {
        "title": TITLE,
        "author": AUTHOR,
        "subject": SUBJECT,
        "creator": "Finance Lab",
        "keywords": "Fintechathon, 银行AI智能体, 进度汇报",
    }
    doc.set_metadata(meta)

    # 页脚页码（封面不标）：左侧品牌，右侧 第 X / N 页（内置 CJK 字体，量宽与绘制一致）
    total = doc.page_count
    for i in range(total):
        if i == 0:
            continue
        page = doc[i]
        rect = page.rect
        y = rect.height - 30
        left = f"Finance Lab · 今晚汇报 · 2026-10-12"
        right = f"第 {i + 1} / {total} 页"
        page.insert_text((42, y), left, fontsize=8, fontname="china-s", color=(0.45, 0.42, 0.38))
        tw = fitz.get_text_length(right, fontname="china-s", fontsize=8)
        page.insert_text((rect.width - 42 - tw, y), right, fontsize=8, fontname="china-s",
                         color=(0.45, 0.42, 0.38))
    doc.save(PDF.with_suffix(".pdf.tmp"))
    doc.close()
    os.replace(PDF.with_suffix(".pdf.tmp"), PDF)

    # PNG 预览（视觉验收用）
    preview_dir = Path(tempfile.gettempdir()) / "report_preview_2026-10-12"
    preview_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)
    for i in range(doc.page_count):
        pix = doc[i].get_pixmap(dpi=110, alpha=False)
        pix.save(preview_dir / f"page-{i + 1:02d}.png")
    doc.close()

    size_kb = PDF.stat().st_size // 1024
    print(f"[ok] {PDF}  {len(list(preview_dir.glob('*.png')))} 页, {size_kb} KB")
    print(f"[ok] 预览 PNG: {preview_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
