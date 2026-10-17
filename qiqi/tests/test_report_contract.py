"""导出契约（contracts/report.py）的结构校验测试。

这里只测「契约本身能不能被三个人一致地实现」：
  · 合法产物能通过；
  · 会让渲染器各做各的的结构问题必须被拦下；
  · JSON 往返之后仍然合法（UI 拿到的是 dict，服务端拿回同一套）。
"""
from __future__ import annotations

import unittest

from contracts.report import (
    BLOCK_KINDS,
    CHART_TYPES,
    COLUMN_FORMATS,
    FORMAT_CAPABILITIES,
    SUPPORTED_FORMATS,
    ChartBlock,
    ChartSeries,
    DataProvenance,
    ExportRequest,
    ExportResult,
    HeadingBlock,
    MetricsBlock,
    Metric,
    ReportArtifact,
    ReportMeta,
    ReportSection,
    TableBlock,
    TextBlock,
    assert_valid,
    block_from_dict,
    suggest_filename,
    validate_artifact,
)


def make_valid_artifact() -> ReportArtifact:
    return ReportArtifact(
        artifact_id="art_test",
        title="10 月账单月报",
        period="2026-10",
        subtitle="演示数据",
        meta=ReportMeta(mode="demo", disclaimer="演示数据，非真实账户"),
        provenance=[DataProvenance(source="demo", dataset="bill_report.2026-10", as_of="2026-10-17")],
        sections=[
            ReportSection(
                section_id="s1",
                title="总览",
                blocks=[
                    HeadingBlock(text="本月支出"),
                    TextBlock(text="本月共 42 笔支出。"),
                    MetricsBlock(metrics=[Metric(label="总支出", value=3280.5, unit="元")]),
                    TableBlock(
                        title="分类",
                        columns=["分类", "金额", "占比"],
                        rows=[["餐饮", 1200.0, 0.37], ["交通", 480.0, 0.14]],
                        column_formats=["text", "money", "percent"],
                    ),
                    ChartBlock(
                        title="支出结构",
                        chart_type="pie",
                        x_labels=["餐饮", "交通"],
                        series=[ChartSeries(name="金额", points=[1200.0, 480.0])],
                    ),
                ],
            )
        ],
    )


class ReportContractTests(unittest.TestCase):

    def test_valid_artifact_passes(self):
        self.assertEqual(validate_artifact(make_valid_artifact()), [])

    def test_assert_valid_raises_with_reasons(self):
        artifact = make_valid_artifact()
        artifact.sections[0].blocks.append(TableBlock(columns=["a", "b"], rows=[["x"]]))
        with self.assertRaises(ValueError) as ctx:
            assert_valid(artifact)
        self.assertIn("行有 1 列", str(ctx.exception))

    def test_demo_requires_disclaimer(self):
        artifact = make_valid_artifact()
        artifact.meta.disclaimer = ""
        self.assertTrue(any("disclaimer" in p for p in validate_artifact(artifact)))

    def test_missing_provenance_rejected(self):
        artifact = make_valid_artifact()
        artifact.provenance = []
        self.assertTrue(any("数据来源" in p for p in validate_artifact(artifact)))

    def test_section_provenance_is_enough(self):
        artifact = make_valid_artifact()
        artifact.provenance = []
        artifact.sections[0].provenance = [
            DataProvenance(source="user_import", dataset="bank_csv", as_of="2026-10-16")
        ]
        self.assertEqual(validate_artifact(artifact), [])

    def test_live_mode_with_demo_source_rejected(self):
        artifact = make_valid_artifact()
        artifact.meta.mode = "live"
        artifact.meta.disclaimer = "真实数据"
        self.assertTrue(any("demo 来源" in p for p in validate_artifact(artifact)))

    def test_unknown_provenance_source_rejected(self):
        artifact = make_valid_artifact()
        artifact.provenance[0].source = "guess"
        self.assertTrue(any("未知数据来源" in p for p in validate_artifact(artifact)))

    def test_table_column_format_length_must_match(self):
        artifact = make_valid_artifact()
        artifact.sections[0].blocks = [
            TableBlock(columns=["a", "b"], rows=[[1, 2]], column_formats=["money"])
        ]
        self.assertTrue(any("column_formats" in p for p in validate_artifact(artifact)))

    def test_chart_series_length_must_match_labels(self):
        artifact = make_valid_artifact()
        artifact.sections[0].blocks = [
            ChartBlock(chart_type="bar", x_labels=["1月", "2月"], series=[ChartSeries(name="收入", points=[1.0])])
        ]
        self.assertTrue(any("≠ x_labels" in p for p in validate_artifact(artifact)))

    def test_pie_allows_single_series_only(self):
        artifact = make_valid_artifact()
        artifact.sections[0].blocks = [
            ChartBlock(
                chart_type="pie",
                x_labels=["a", "b"],
                series=[ChartSeries(name="一", points=[1.0, 2.0]), ChartSeries(name="二", points=[1.0, 2.0])],
            )
        ]
        self.assertTrue(any("只允许一条 series" in p for p in validate_artifact(artifact)))

    def test_image_external_url_rejected(self):
        artifact = make_valid_artifact()
        from contracts.report import ImageBlock

        artifact.sections[0].blocks = [ImageBlock(path="https://example.com/a.png")]
        self.assertTrue(any("禁止外链" in p for p in validate_artifact(artifact)))

    def test_empty_section_rejected(self):
        artifact = make_valid_artifact()
        artifact.sections.append(ReportSection(section_id="s2", title="空章节"))
        self.assertTrue(any("没有内容块" in p for p in validate_artifact(artifact)))

    def test_json_roundtrip_keeps_validity(self):
        artifact = make_valid_artifact()
        payload = artifact.to_dict()
        rebuilt = ReportArtifact(
            artifact_id=payload["artifact_id"],
            title=payload["title"],
            period=payload["period"],
            meta=ReportMeta(**payload["meta"]),
            provenance=[DataProvenance(**p) for p in payload["provenance"]],
            sections=[
                ReportSection(
                    section_id=section["section_id"],
                    title=section["title"],
                    blocks=[block_from_dict(b) for b in section["blocks"]],
                )
                for section in payload["sections"]
            ],
        )
        self.assertEqual(validate_artifact(rebuilt), [])
        self.assertEqual(len(rebuilt.sections[0].blocks), len(artifact.sections[0].blocks))

    def test_portability_targets_cover_every_block_kind(self):
        self.assertEqual(set(FORMAT_CAPABILITIES), set(SUPPORTED_FORMATS))
        covered: set[str] = set()
        for kinds in FORMAT_CAPABILITIES.values():
            for kind in kinds:
                self.assertIn(kind, BLOCK_KINDS)
                covered.add(kind)
        self.assertEqual(covered, set(BLOCK_KINDS))

    def test_column_and_chart_vocabulary_is_closed(self):
        artifact = make_valid_artifact()
        artifact.sections[0].blocks = [
            TableBlock(columns=["a"], rows=[[1]], column_formats=["currency"]),
            ChartBlock(chart_type="radar", x_labels=["a"], series=[ChartSeries(name="s", points=[1.0])]),
        ]
        problems = validate_artifact(artifact)
        self.assertTrue(any("未知列格式" in p for p in problems))
        self.assertTrue(any("未知图表类型" in p for p in problems))
        self.assertIn("money", COLUMN_FORMATS)
        self.assertIn("bar", CHART_TYPES)

    def test_export_result_defaults(self):
        result = ExportResult(request=ExportRequest(artifact_id="art_test", format="pdf"))
        self.assertEqual(result.status, "done")
        self.assertTrue(result.rendered_at)

    def test_suggest_filename(self):
        artifact = make_valid_artifact()
        self.assertEqual(suggest_filename(artifact, "xlsx"), "10_月账单月报-2026-10.xlsx")


if __name__ == "__main__":
    unittest.main()
