# Finance Lab · 统一接口契约（暂存/正式共用）

## 模型请求

`POST /api/review`

```json
{"question":"请检查我的持仓健康状况"}
```

响应必须保留 `run_id`、`decision_source`、`model_status`、`execution_state`、`recommendation`、`gate`、`whatif` 和审计关联字段。`demo` 模式在模型不可用时明确返回 `decision_source: "rules"`；`live` 模式在 Key 缺失或调用失败时返回 `status: "error"`、`code: "MODEL_UNAVAILABLE"`，不能伪装成模型成功。

## 六场景请求

- `POST /api/scenarios/run`：自然语言输入，返回场景、意图槽位、任务 DAG、权限等级和结果/待确认项。
- `POST /api/scenarios/confirm`：确认黄色/红色待办，服务端重新核验余额、日累计、卡状态、审批状态和强验证信息。
- `POST /api/scenarios/cancel`：取消待办或预约。
- `GET /api/scenarios/pending`：读取待确认队列。
- `GET /api/audit`：读取审计时间线。
- `POST /api/breaker/reset`：人工确认原因后恢复熔断。

所有金额单位为元，时间使用 ISO 字符串；演示记录带 `source: "demo"` 和 `as_of`，不能表述为实时银行数据。模型只提出建议，确定性代码执行意图解析、金额/限额校验、风控闸门和回执状态。

## UI 对齐

UI 以 JSON 契约消费结构化结果：意图、DAG 节点、权限、证据、审批/执行状态、审计和情景推演分别渲染；待确认不显示为已执行。

PDF / PPT / Word / Excel / 图形的**渲染器尚未实现**，但导出结构已统一到 `ReportArtifact`（见下节）：渲染器与 UI 消费同一份产物，不在各模块另起接口。

## 报告产物与导出契约

agent 不拼 HTML，也不各自定义导出数据：统一产出 `ReportArtifact`（`qiqi/contracts/report.py`），由各格式渲染器与 UI 共同消费。

结构摘要：

- 顶层：`artifact_id / title / period / subtitle / layout / export_formats[]`
- `meta`：`mode`（demo/live/mixed）、`generated_at`、`run_id`、`audit_refs[]`、`sensitivity`、`disclaimer`
- `provenance[]`：`source`（demo/live/user_import/model/memory）、`dataset`、`as_of`、`note`
- `sections[]`：`section_id / title / page_break_before / blocks[] / provenance[]`
- `blocks[]`：封闭集合 `heading / text / bullets / metrics / table / chart / callout / image`
- `export_formats[]`：`pdf / pptx / docx / xlsx / png / html`

三条硬校验（`validate_artifact`，不通过不得出文件）：

1. artifact 或每个 section 至少有一份 `provenance`，`as_of` 必须是 ISO 时间；
2. `mode="demo"` 必须填 `disclaimer`；`mode="live"` 混入 demo 来源判为口径不一致；
3. `table` 每行长度等于 `columns`；`chart` 每条 series 点数等于 `x_labels`；`pie/donut` 只允许一条 series；`image.path` 不允许外链。

跨格式分页只用一个开关：`section.page_break_before` = PDF/Word 另起一页、PPT 另起一张幻灯片、Excel 另起一个工作表、PNG 另起一张图。

数字格式由 `column_formats`（`text / int / money / percent / date / delta`）统一声明；各渲染器不得自行格式化金额与百分比，否则五个格式的观感必然不一致。

导出接口（路径待 UI Owner 确认后实现，当前为约定）：

- `GET /api/report/<artifact_id>`：返回 artifact JSON；
- `POST /api/report/<artifact_id>/export`：请求 `{format, filename?, options?}`，返回 `ExportResult`；某渲染器表达不了某个块时必须返回 `status="unsupported"` 并指明块类型，禁止静默丢块。

完整说明、JSON 样例与验收清单：[`qiqi/docs/导出契约_2026-10-17.md`](../../qiqi/docs/导出契约_2026-10-17.md)。

## 模型配置

默认 `base_url=https://api.deepseek.com`、`model=deepseek-chat`，也可替换为兼容 OpenAI Chat Completions 形式的服务。只使用启动环境中的 `DEEPSEEK_API_KEY`；禁止把 Key、Plus 账号或本机凭据提交到仓库。