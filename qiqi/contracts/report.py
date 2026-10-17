"""报告产物统一契约（2026-10-17 新增）。

背景（10-17 团队会，队长口径）：
  「agent 生成、整理的数据，怎么以 PDF、PPT、Word、Excel、图形这些形式在 UI 里
  更美观优雅地呈现，接口要和小果、林粹对一套，不要各做各的。」
  本文件就是那「一套」：

    · agent 侧：只产出 ReportArtifact（结构化内容 + 来源 + 免责声明），不碰排版；
    · 渲染侧：PDF / PPTX / DOCX / XLSX / PNG 各写一个 renderer，只消费本契约；
    · UI 侧：直接渲染同一份 artifact（html 目标），屏幕所见与导出文件一致。

设计约束：
  · 一个 artifact 可同时导多种格式，块类型必须能被每种目标格式表达；
  · 图表只传数据、不传图片，由各渲染器用原生图表重绘（Excel/PPT 原生图表对象、
    PDF 矢量），既避免位图糊，也避免各端画出来的图不一致；
  · 数据来源、数据截止时间、模式（demo/live）随产物一起走——缺来源的产物
    validate_artifact 不通过（对齐仓库「来源不可追溯不得进入执行链路」的口径）；
  · 不引用任何外链资源（断网可用），图片块只允许本地相对路径。

命名约定（与 contracts/types.py、contracts/banking.py 一致）：
  · 金额一律元（float），渲染时保留两位；时间一律 ISO 字符串；
  · 比例用 0~1 的小数，靠 column_formats="percent" 交给渲染器显示；
  · 文本不做 Markdown 解析，避免各渲染器对强调/列表的解释不一致。
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal

# ============================================================
#  目标格式与块类型
# ============================================================

ReportFormat = Literal["pdf", "pptx", "docx", "xlsx", "png", "html"]

SUPPORTED_FORMATS: tuple[str, ...] = ("pdf", "pptx", "docx", "xlsx", "png", "html")

BlockKind = Literal[
    "heading", "text", "bullets", "metrics", "table", "chart", "callout", "image"
]

BLOCK_KINDS: tuple[str, ...] = (
    "heading", "text", "bullets", "metrics", "table", "chart", "callout", "image",
)

# 列格式决定渲染器的原生格式化方式：Excel 单元格格式 / Word 表格样式 /
# PPT 表格 / PDF 文本绘制都用这一列声明，避免各端各自 format。
ColumnFormat = Literal["text", "int", "money", "percent", "date", "delta"]

COLUMN_FORMATS: tuple[str, ...] = ("text", "int", "money", "percent", "date", "delta")

ChartType = Literal["line", "bar", "hbar", "area", "pie", "donut", "scatter"]

CHART_TYPES: tuple[str, ...] = ("line", "bar", "hbar", "area", "pie", "donut", "scatter")

# 每种目标格式能表达的块类型。UI 据此决定「导出」菜单里给不给这个选项，
# 渲染器据此在 unsupported 时明确报错而不是静默丢块。
FORMAT_CAPABILITIES: dict[str, list[str]] = {
    "pdf": list(BLOCK_KINDS),
    "docx": list(BLOCK_KINDS),
    "pptx": list(BLOCK_KINDS),
    # Excel 没有「页面」概念：page_break_before 映射为新建工作表，叙事块按行铺排。
    "xlsx": list(BLOCK_KINDS),
    "html": list(BLOCK_KINDS),
    # 单图导出：只取图表/图片/关键指标，多图则按块顺序出多页。
    "png": ["heading", "text", "metrics", "chart", "image"],
}

# 来源类型：demo 演示数据 / live 真实接入 / user_import 用户导入账单 /
# model 模型生成的观点 / memory 记忆层沉淀
PROVENANCE_SOURCES: tuple[str, ...] = ("demo", "live", "user_import", "model", "memory")


# ============================================================
#  内容块
# ============================================================


@dataclass
class DataProvenance:
    """一块数据从哪来、截止到什么时候——产物必带，缺了校验不过。"""
    source: str                  # PROVENANCE_SOURCES 之一
    dataset: str = ""            # 数据集/模块名，如 bill_report.2026-10
    as_of: str = ""              # 数据截止（ISO 日期或日期时间）
    note: str = ""               # 口径说明，如「按商户归一后去重」


@dataclass
class ReportBlock:
    """所有内容块的基类。子类用 kind 区分，渲染器按 kind 分派。"""
    kind: str = ""
    title: str = ""
    text: str = ""
    source_refs: list[str] = field(default_factory=list)   # 关联的 DataProvenance.dataset 或交易ID


@dataclass
class HeadingBlock(ReportBlock):
    """章节标题。level=1 在 PPT 里等同新页主标题，在 Excel 里等同分组行。"""
    kind: str = "heading"
    level: int = 1


@dataclass
class TextBlock(ReportBlock):
    """一段正文。不做 Markdown；要分条请用 bullets。"""
    kind: str = "text"


@dataclass
class BulletsBlock(ReportBlock):
    """无序要点。items 每条一句，渲染器不自动加序号。"""
    kind: str = "bullets"
    items: list[str] = field(default_factory=list)


@dataclass
class Metric:
    """单个关键指标。value 允许字符串（如「3.2 个月」这类非数值口径）。"""
    label: str
    value: float | str
    unit: str = ""
    delta: float | None = None     # 环比变化，正负号自带
    tone: str = "neutral"          # neutral / good / warn / bad
    note: str = ""


@dataclass
class MetricsBlock(ReportBlock):
    """一排关键指标卡。PDF/Word 横排，Excel 按两列铺，PPT 一行卡片。"""
    kind: str = "metrics"
    metrics: list[Metric] = field(default_factory=list)


@dataclass
class TableBlock(ReportBlock):
    """表格。rows 的每行长度必须等于 columns，否则校验不过。"""
    kind: str = "table"
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    column_formats: list[str] = field(default_factory=list)   # 与 columns 等长，缺省按 text
    align: list[str] = field(default_factory=list)            # left / right / center，缺省 text 左、数值右
    highlight_rows: list[int] = field(default_factory=list)   # 0 基行号，渲染强调色
    total_row: bool = False                                   # 最后一行是合计行（加粗+上分隔线）
    note: str = ""


@dataclass
class ChartSeries:
    name: str
    points: list[float | None] = field(default_factory=list)   # None 表示该点缺数据，不补零


@dataclass
class ChartBlock(ReportBlock):
    """图表块。只传数据，各渲染器用原生图表重绘。

    pie/donut 只允许一条 series，x_labels 即扇区名；
    其余类型每条 series 的 points 长度必须等于 x_labels 长度。
    """
    kind: str = "chart"
    chart_type: str = "bar"
    x_labels: list[str] = field(default_factory=list)
    series: list[ChartSeries] = field(default_factory=list)
    unit: str = ""
    stacked: bool = False
    show_values: bool = False
    note: str = ""


@dataclass
class CalloutBlock(ReportBlock):
    """提示框。风控结论、口径说明、未接真实 API 的 Mock 标注都放这里。"""
    kind: str = "callout"
    tone: str = "info"             # info / warn / risk / success


@dataclass
class ImageBlock(ReportBlock):
    """本地图片。只允许相对路径；写死禁止 http(s)，保证断网可用。"""
    kind: str = "image"
    path: str = ""
    alt: str = ""
    caption: str = ""


_BLOCK_TYPES: dict[str, type[ReportBlock]] = {
    "heading": HeadingBlock,
    "text": TextBlock,
    "bullets": BulletsBlock,
    "metrics": MetricsBlock,
    "table": TableBlock,
    "chart": ChartBlock,
    "callout": CalloutBlock,
    "image": ImageBlock,
}


# ============================================================
#  章节 / 排版 / 元信息
# ============================================================


@dataclass
class ReportSection:
    """一个章节，映射规则：

      · PDF/Word：一页或连续正文；
      · PPT：page_break_before=True 时另起一页幻灯片；
      · Excel：page_break_before=True 时另起一个工作表（工作表名取 title）；
      · PNG：每张图一页。
    """
    section_id: str
    title: str
    blocks: list[ReportBlock] = field(default_factory=list)
    page_break_before: bool = False
    provenance: list[DataProvenance] = field(default_factory=list)
    note: str = ""


@dataclass
class ReportLayout:
    """排版意图。只给到「意图」层，不指定像素，避免各渲染器跑偏。"""
    page_size: str = "A4"          # A4 / A3 / letter / 16:9（PPT）
    orientation: str = "portrait"  # portrait / landscape
    density: str = "comfortable"   # comfortable / compact
    accent_color: str = "#1F6FEB"  # 主色，渲染器只用于强调，不改语义
    font_family: str = ""          # 空 = 各平台默认中文字体
    show_toc: bool = True


@dataclass
class ReportMeta:
    """产物元信息。mode 与 provenance 必须自洽，否则校验不过。"""
    mode: str = "demo"                # demo / live / mixed
    generated_at: str = ""
    generated_by: str = "agent"       # agent / user
    user_id: str = ""
    run_id: str = ""                  # 与 AgentResponse.run_id 对齐，便于审计回放
    audit_refs: list[str] = field(default_factory=list)   # 关联的任务/审批 ID
    sensitivity: str = "private"      # public / internal / private
    disclaimer: str = ""              # demo 模式必填，写明模拟范围
    contract_version: str = "1.0"

    def __post_init__(self) -> None:
        if not self.generated_at:
            self.generated_at = datetime.now().isoformat(timespec="seconds")


# ============================================================
#  产物本体
# ============================================================


@dataclass
class ReportArtifact:
    """一份可渲染、可导出的产物。这是跨模块唯一的交付形态。"""
    artifact_id: str
    title: str
    period: str = ""                  # 2026-10 / 2026Q3 / 2026-10-01~2026-10-17
    subtitle: str = ""
    sections: list[ReportSection] = field(default_factory=list)
    meta: ReportMeta = field(default_factory=ReportMeta)
    layout: ReportLayout = field(default_factory=ReportLayout)
    provenance: list[DataProvenance] = field(default_factory=list)   # 章节未单列时继承这里
    export_formats: list[str] = field(default_factory=lambda: list(SUPPORTED_FORMATS))

    def __post_init__(self) -> None:
        if not self.artifact_id:
            self.artifact_id = f"art_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> dict:
        """JSON 友好结构，直接给 Web 层 / UI 用。"""
        return asdict(self)


# ============================================================
#  导出请求 / 结果（Web 层与 UI 的接口）
# ============================================================


@dataclass
class ExportRequest:
    """一次导出请求。filename 为空时由 suggest_filename() 生成。"""
    artifact_id: str
    format: str                       # ReportFormat
    filename: str = ""
    options: dict = field(default_factory=dict)   # 渲染参数透传（不参与契约语义）


@dataclass
class ExportResult:
    request: ExportRequest
    status: str = "done"              # done / failed / unsupported
    path: str = ""                    # 服务端生成的本地文件路径（不返回外链）
    bytes_written: int = 0
    renderer: str = ""                # 哪个渲染器输出的，便于排查
    error: str = ""
    rendered_at: str = ""

    def __post_init__(self) -> None:
        if not self.rendered_at:
            self.rendered_at = datetime.now().isoformat(timespec="seconds")


# ============================================================
#  校验与工具
# ============================================================


def _is_iso(value: str) -> bool:
    if not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_artifact(artifact: ReportArtifact) -> list[str]:
    """返回问题清单；空列表表示可交付。渲染器应在生成文件前调用。

    校验只做「会不会让三个人各做各的」这类结构性问题，不评价内容好坏。
    """
    problems: list[str] = []

    if not artifact.artifact_id:
        problems.append("artifact_id 为空")
    if not artifact.title.strip():
        problems.append("title 为空")
    if not artifact.sections:
        problems.append("sections 为空")
    if not artifact.provenance and not any(s.provenance for s in artifact.sections):
        problems.append("缺少数据来源：artifact 与章节都未提供 provenance")

    fmt_set = set(SUPPORTED_FORMATS)
    for fmt in artifact.export_formats:
        if fmt not in fmt_set:
            problems.append(f"export_formats 含未知格式：{fmt}")

    if artifact.meta.mode not in ("demo", "live", "mixed"):
        problems.append(f"meta.mode 非法：{artifact.meta.mode}")
    if artifact.meta.mode == "demo" and not artifact.meta.disclaimer.strip():
        problems.append("mode=demo 必须填写 disclaimer，写明模拟范围")

    sources = {p.source for p in artifact.provenance}
    for section in artifact.sections:
        sources |= {p.source for p in section.provenance}
    for src in sources:
        if src not in PROVENANCE_SOURCES:
            problems.append(f"未知数据来源：{src}")
    if artifact.meta.mode == "live" and "demo" in sources:
        problems.append("mode=live 但 provenance 含 demo 来源，口径不一致")

    for prov in [*artifact.provenance, *[p for s in artifact.sections for p in s.provenance]]:
        if prov.as_of and not _is_iso(prov.as_of):
            problems.append(f"provenance.as_of 非 ISO：{prov.as_of}")

    seen_section_ids: set[str] = set()
    for section in artifact.sections:
        if not section.section_id:
            problems.append(f"章节「{section.title}」缺 section_id")
        elif section.section_id in seen_section_ids:
            problems.append(f"section_id 重复：{section.section_id}")
        seen_section_ids.add(section.section_id)
        if not section.blocks:
            problems.append(f"章节「{section.title}」没有内容块")
        for block in section.blocks:
            problems.extend(_validate_block(section, block))

    return problems


def _validate_block(section: ReportSection, block: ReportBlock) -> list[str]:
    where = f"章节「{section.title}」"
    problems: list[str] = []

    if block.kind not in BLOCK_KINDS:
        return [f"{where} 含未知块类型：{block.kind}"]

    if isinstance(block, HeadingBlock):
        if not (1 <= block.level <= 4):
            problems.append(f"{where} heading.level 应在 1~4")
        if not block.text.strip():
            problems.append(f"{where} heading 缺少 text")

    elif isinstance(block, TextBlock):
        if not block.text.strip():
            problems.append(f"{where} text 块内容为空")

    elif isinstance(block, BulletsBlock):
        if not block.items:
            problems.append(f"{where} bullets 为空")

    elif isinstance(block, MetricsBlock):
        if not block.metrics:
            problems.append(f"{where} metrics 为空")
        for metric in block.metrics:
            if not metric.label.strip():
                problems.append(f"{where} metric 缺 label")
            if metric.tone not in ("neutral", "good", "warn", "bad"):
                problems.append(f"{where} metric.tone 非法：{metric.tone}")

    elif isinstance(block, TableBlock):
        if not block.columns:
            problems.append(f"{where} table 缺 columns")
        if not block.rows:
            problems.append(f"{where} table 无数据行")
        if block.column_formats and len(block.column_formats) != len(block.columns):
            problems.append(f"{where} column_formats 长度与 columns 不一致")
        for fmt in block.column_formats:
            if fmt not in COLUMN_FORMATS:
                problems.append(f"{where} 未知列格式：{fmt}")
        if block.align and len(block.align) != len(block.columns):
            problems.append(f"{where} align 长度与 columns 不一致")
        for idx, row in enumerate(block.rows):
            if len(row) != len(block.columns):
                problems.append(
                    f"{where} table 第 {idx} 行有 {len(row)} 列，columns 是 {len(block.columns)} 列"
                )
                break
        for idx in block.highlight_rows:
            if not (0 <= idx < len(block.rows)):
                problems.append(f"{where} highlight_rows 越界：{idx}")

    elif isinstance(block, ChartBlock):
        if block.chart_type not in CHART_TYPES:
            problems.append(f"{where} 未知图表类型：{block.chart_type}")
        if not block.series:
            problems.append(f"{where} chart 无 series")
        if block.chart_type in ("pie", "donut"):
            if len(block.series) != 1:
                problems.append(f"{where} pie/donut 只允许一条 series")
            if len(block.series[0].points) != len(block.x_labels):
                problems.append(f"{where} pie/donut 的 points 与 x_labels 长度不一致")
        else:
            for series in block.series:
                if len(series.points) != len(block.x_labels):
                    problems.append(
                        f"{where} series「{series.name}」点数 {len(series.points)} "
                        f"≠ x_labels {len(block.x_labels)}"
                    )
                    break

    elif isinstance(block, CalloutBlock):
        if block.tone not in ("info", "warn", "risk", "success"):
            problems.append(f"{where} callout.tone 非法：{block.tone}")
        if not block.text.strip():
            problems.append(f"{where} callout 内容为空")

    elif isinstance(block, ImageBlock):
        if not block.path.strip():
            problems.append(f"{where} image 缺 path")
        elif "://" in block.path:
            problems.append(f"{where} image 只允许本地路径，禁止外链：{block.path}")

    return problems


def block_from_dict(data: dict) -> ReportBlock:
    """把 JSON 结构还原成对应块类型（渲染器/测试用）。"""
    kind = data.get("kind", "")
    cls = _BLOCK_TYPES.get(kind)
    if cls is None:
        raise ValueError(f"未知块类型：{kind}")
    allowed = {f.name for f in getattr(cls, "__dataclass_fields__", {}).values()}
    kwargs = {k: v for k, v in data.items() if k in allowed}
    if cls is MetricsBlock and "metrics" in kwargs:
        kwargs["metrics"] = [
            m if isinstance(m, Metric) else Metric(**m) for m in kwargs["metrics"]
        ]
    if cls is ChartBlock and "series" in kwargs:
        kwargs["series"] = [
            s if isinstance(s, ChartSeries) else ChartSeries(**s) for s in kwargs["series"]
        ]
    return cls(**kwargs)


def assert_valid(artifact: ReportArtifact) -> None:
    """渲染前置调用：有问题直接抛错，不允许带病出文件。"""
    problems = validate_artifact(artifact)
    if problems:
        raise ValueError("产物契约校验未通过：" + "；".join(problems))


def suggest_filename(artifact: ReportArtifact, fmt: str) -> str:
    """默认文件名：标题-周期.扩展名。标题里的空格/斜杠替换为下划线。"""
    stem = f"{artifact.title}-{artifact.period}".strip("-")
    for ch in ' /\\:*?"<>|':
        stem = stem.replace(ch, "_")
    return f"{stem or artifact.artifact_id}.{fmt}"
