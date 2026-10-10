# 投资 Agent 公共 Contract

investment-agent.v1.schema.json 是投资 Agent、Backend 和 Risk 共用的公共 Schema。当前只冻结投资健康检查链路；店主财务助手仍使用自己的账单接口，避免两个产品混用字段。

## 统一请求

POST /api/health-check/run 只能接收版本化信封：

字段职责：

- contract_version：协议版本，改字段语义时必须升版本。
- request_id：一次请求的追踪编号，Agent、Backend、Risk 日志必须原样保留。
- context：任务续跑所需的 task_id、session_id，以及固定演示数据模式。
- input：Risk 需要复核的风险偏好和持仓输入。缺少偏好字段时，Agent 返回澄清状态，不自行补值。

## 统一响应

Backend 会在请求进入时校验一次，并在 Agent 交给 Risk 前再校验一次。响应固定包含：

- task_state：任务当前状态。WAITING_INPUT 表示需要补信息，HANDOFF_REQUIRED 表示已到 Risk 边界。
- artifacts：持仓快照、健康报告、候选方案和模拟结果。
- tool_results：每个工具的版本、输入哈希、数据日期、警告和追踪编号。
- trace：把 request_id、task_id、session_id 和 contract_version 固定放在同一个关联对象中。
- audit_evidence：记录会话创建、阶段开始/完成、重试、交接和错误事件；它与 Risk Handoff 共用 audit_id。
- risk_handoff：仅在 HANDOFF_REQUIRED 时生成，包含 Risk 所需的证据 ID；execution_allowed 永远为 false，不能把 Agent 输出当作交易授权。

请求可以附带可选的 `market_context`。它只表示一份有来源和数据日期的市场简报上下文，用于异常标记和 Risk 复核，不会覆盖或重新计算 Quant 的组合收益、回撤、相关性和模拟结果。价格与消息方向冲突时只生成 `REVIEW_REQUIRED`，不自动转换为交易动作。

Risk 只消费 risk_handoff.evidence 指向的结果，并按 contract_version、task_id、session_id 和 request_id 关联记录。前端传来的 approval 字段不是 Risk 决策，也不能绕过 Safety Action Gateway。

## 示例与地址

- 请求示例：contracts/examples/health-check.request.json
- 响应示例：contracts/examples/health-check.response.json
- 在线运行时 Schema：/contracts/investment-agent.v1.schema.json
- 在线运行时请求示例：/contracts/examples/health-check.request.json
- 在线运行时响应示例：/contracts/examples/health-check.response.json
- 市场简报测试夹具：data/market-brief-2026-10-08.json、data/market-brief-2026-10-09.json
- 风控工作台联调页面：/risk-workbench
- 风控工作台适配接口：POST /api/risk-workbench/handoff

PowerShell 调用示例：

    $body = Get-Content .\contracts\examples\health-check.request.json -Raw
    Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4175/api/health-check/run -ContentType 'application/json' -Body $body

错误响应的 error 固定包含 code、message、retryable、stage 和 recovery；需要人工修复时由 recovery 给出恢复方向。缺少 contract_version、request_id、context 或 input 时，Backend 返回 422 INVALID_CONTRACT。不要在生产代码中拼接旧的裸字段请求。

风控工作台适配接口当前只生成 READ_ONLY_HANDOFF_PREVIEW，不伪造远程写入，不提交确认，不触发执行。远程工作台没有公开外部 Handoff 导入接口前，Core Agent 只能通过适配层把证据整理给人工复核。

## 2026-10-10 字段责任与联调冻结表

本表解释现有 investment-agent.v1 Schema，不变更运行时版本或校验器。必填表示 Schema required；条件必填是本轮联调要求，尚未全部由 Schema 强制。响应来自 Core Agent，由 Backend 传递，UI/Risk 只消费。

| 字段 / Contract | 必填与当前状态 | 生产方 → 消费方 | 修改权与证据 |
| --- | --- | --- | --- |
| Request contract_version / request_id / operation / context / input | 全必填；version=investment-agent.v1；operation=PORTFOLIO_HEALTH_CHECK | Caller → Backend/Core Agent | version 由协议约定；下游不能改 request_id；HealthCheckRequest |
| context.actor / environment / data_mode | 全必填；agent / demo / SYNTHETIC_REPLAY | Caller → Harness | 不擅自升级为真实数据或生产模式；RequestContext |
| context.task_id / session_id | 可选或 null；新任务由 Harness 生成，续跑传原值；session 不匹配会停止 | Harness → Caller → Harness | Caller 不编造任务、不改变绑定 |
| input.risk_profile / portfolio / market_context | 前两项必填且可 null，market_context 可选；缺偏好 WAITING_INPUT，null portfolio 使用 demo | Caller/Data → Core Agent/Tools | 不替用户补偏好，不改数据日期；HealthCheckInput |
| Response 顶层 | contract_version/request_id/operation/trace/task_state/artifacts/tool_results/audit_evidence/risk_handoff 全必填 | Core Agent → Backend → UI/Risk | 不移除字段；HealthCheckResponse |
| trace | version/request/task/session 四键全必填 | Core Agent → Backend/UI/Risk | 下游原样关联；Trace |
| task_state | task_id/session_id/stage/status/missing_fields/checkpoint 必填；version/request_id/error_state 运行时存在但 Schema 可选 | Harness → Backend/UI | Harness 唯一修改；Risk/UI 不改为审批状态；TaskState |
| checkpoint | stage/completed/result_refs/resume_token 必填 | Harness → Harness/UI | Harness 维护；result_refs 必须能解析 ToolResult；Checkpoint |
| artifacts | 顶层必填，内部无 required；成功交接需 snapshot/report/candidates/simulation，市场证据条件存在 | Tools/Quant → Core Agent → Risk/UI | Core Agent 不改 metrics/target_weights/comparisons；Artifacts |
| tool_results | 顶层必填；每项 tool_name/version/inputs_hash/output/data_as_of/warnings/trace_id 全必填 | Tools → Harness → UI/Risk | 工具拥有 output/version；Core Agent 只组织结果；ToolResult |
| audit_evidence | audit_id/version/request/task/session/events 全必填；request_id 允许 null | Harness → Backend/UI/Risk | 事件只由 Harness 生成；不是 Memory 自动回写；AuditEvidence |
| audit_evidence.events[] | event_id/task_id/actor/event_type/payload/timestamp 全必填 | Harness → 审计读取/UI/Risk | 下游不得伪造事件；AuditEvent |
| risk_handoff | 顶层必填但允许 null；仅 HANDOFF_REQUIRED 生成 | Core Agent → Risk/UI | status=PENDING_REVIEW，decision=REQUIRED，execution_allowed=false 固定；RiskHandoff |
| risk_handoff.evidence | snapshot/report/proposal_ids/simulation 必填；market_context_id/audit_id Schema 可选，联调条件必填 | Core Agent → Risk | 引用必须对应 artifacts/audit；Risk/UI 不改 Quant 证据 |
| Error envelope | version/request_id/operation/error 必填；request_id 可 null；error.code/message/retryable/stage/recovery 必填，details 可选 | Backend → Caller/UI | 不把错误转成成功或授权；HealthCheckErrorResponse |
| TaskState 异常 | READY/RUNNING/WAITING_INPUT/HANDOFF_REQUIRED/BLOCKED/FAILED/CIRCUIT_OPEN；error_state 可 null，非空需 code/message/stage/retryable/recovery | Harness → Backend/UI | UI 展示澄清/修复入口，不自行解锁熔断 |
| Risk Workbench bridge | bridge_version=risk-workbench.bridge@0.1.0；外层 integration_version=core-agent-to-risk-workbench.demo@0.1.0 | Adapter → UI/人工复核 | 当前只有 JS 生产器与测试，无独立公共 JSON Schema；不可声称正式 Risk 接收 |

待确认的兼容缺口（记录问题，不修改实现）：

- RiskHandoff 内无 request_id，消费必须保留父 Response.trace/audit_evidence 或 bridge.source；Risk Owner 需确认接收及 review_status/rejection_reason/decision 回写 Contract，当前回写未冻结。
- Schema 未强制跨对象 ID 相等、checkpoint 引用有效及条件 evidence 完整；本轮检查验证成功路径，不代表所有输入均由 Schema 保护。Backend Owner 需确定语义校验层。
- 工具失败在 request_id 写入 TaskState 前抛出；失败信封无 task_id/session_id/audit_id，且部分 404/503 路由仍为简化错误。Backend Owner 需设计兼容错误追踪和升版，不由日报修改代码。
- 同 task 续跑 audit_id 保持不变，审计信封 request_id 更新为最新请求；历史编号在 contract.accepted.payload 中保留，阶段事件不逐条携带 request_id。跨重试完整请求归因仍待 Backend 确认。
- Session、TaskState、AuditEvidence 目前驻留内存。长期 checkpoint/audit 存储和跨进程恢复尚未实现；不得混用 Memory 生命周期规则。

证据：investment-agent.v1.schema.json、investment-contract.js、../core/harness.js、../integrations/risk-workbench-adapter.js、../tests/contracts.test.js、../tests/http.test.js、../docs/core-agent-verification-2026-10-10.md。
