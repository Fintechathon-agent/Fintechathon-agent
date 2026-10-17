# Core Agent 联调手册 2026-10-17

已实现两条主链路，已验证回归与审计关联；正式 Risk 身份、接收与审核闭环待 Owner 确认。本手册解释现有版本，不新增运行时 Schema；覆盖并修正旧手册关于 session_id 缺失和共享错误尚未统一的旧结论。

## 架构职责与边界

- Core Agent：组织结果、版本与 Handoff；不重算 Quant，不产生授权。
- Backend：HTTP、Contract、身份、错误映射与审计读取；消费原始 ID，不改证据。
- Harness：健康四阶段调度、有限重试、结果复用；唯一维护 TaskState/Checkpoint。
- Session 与 Context：健康 session 绑定、actor/environment/data_mode；模型 session 只是关联字段，不证明共用 Session 存储。
- TaskState：stage/status/checkpoint/completed/result_refs/resume_token；会话错配、缺输入、失败停止。
- Tools 与 Quant：validatePortfolio、diagnosePortfolio、generateCandidates、runSimulation；工具拥有版本/日期/输出。
- Memory：独立接口，显式 consent 与会话范围；健康链路不自动读取，调用方材料不是可信记忆。
- Risk：消费证据、校验 hash/身份、独立决策；正式接收/回写待 Owner 确认。
- UI：只消费状态、产物和恢复信息；不改审批身份、风险决策或 execution_allowed。
- Audit：健康 audit_evidence 与模型 audit.events 两种表示；不是 Memory，持久化能力按链路区分。

## 模块调用时序

1. Backend 校验版本与输入；不合法返回 core-agent-error.v1，尚未建任务时 trace 编号为 null。
2. 健康链路装载 Session/Context 并绑定 TaskState；session 不匹配停止，缺偏好 WAITING_INPUT。
3. Harness 按 Checkpoint 调度现有 Tools/Quant，记录完成阶段与 result_refs；失败有限重试，阻止后续阶段。
4. 健康响应装配 artifacts/tool_results/audit_evidence，校验 ID、证据引用与 Handoff。
5. 模型链路创建 task/session/run/audit，调用配置的模型并严格检查六字段；最多两次尝试，共用超时预算；失败留审计。
6. 绑定提议 hash 与 Handoff，保存记录、返回 PENDING_RISK；无主链路自动 Memory 读取，写入须既有 consent 和真实 writer。
7. 显式 risk-dispatch 签名交接；未配置 Risk 返回 503 并保存 FAILED 审计，可按同 task/hash 重试，等待审核。
8. 回调核对六编号、hash、可信身份；重复幂等，证据冲突停止；取消或过期不能解锁。
9. Risk 通过后仍须可信审批，仅进入 PAPER 模拟；每次转换写审计，UI 查询任务与证据，execution_allowed=false。

## 统一 Contract 字段归属

必填列表直接读取当前运行时 Schema 的 required，不把联调期望当成 Schema 已强制。消费方不得修改生产方编号、证据或版本。

### HealthCheckRequest

版本源 contracts/investment-agent.v1.schema.json；Caller → Backend Core Agent。Schema 必填：contract_version, request_id, operation, context, input。

### HealthCheckResponse

版本源 contracts/investment-agent.v1.schema.json；Core Agent → Backend Risk UI。Schema 必填：contract_version, request_id, operation, trace, task_state, artifacts, tool_results, audit_evidence, risk_handoff。

### ReviewRequest

版本源 contracts/model-review.v1.schema.json；Caller → Backend。Schema 必填：kind, text。

### WorkflowRecord

版本源 contracts/model-review.v1.schema.json；Backend ReviewWorkflowStore → UI Risk。Schema 必填：workflow_version, task_id, request_id, run_id, status, model, proposed_action, risk_handoff, risk_decision, approval, execution, audit。

### HandoffPackage

版本源 contracts/risk-handoff.v1.schema.json；Core Agent → Risk。Schema 必填：handoff_version, contract_version, workflow_version, schema_version, handoff_id, task_id, request_id, session_id, run_id, audit_id, data_mode, execution_mode, capability, plan_id, plan_hash, policy_version, owner, record_endpoint, workflow_status, status, decision, execution_allowed, proposal, reviewed_input, input_authority, model, evidence, approval, audit, memory_write_status, trace, callback。

### CallbackRequest

版本源 contracts/risk-handoff.v1.schema.json；Risk → Backend。Schema 必填：handoff_id, task_id, request_id, run_id, audit_id, reviewer, reason, callback_version, proposal_sha256, decision。

### 关联与修改权

request_id 由 Caller/Backend 入口确定；task_id/session_id 由对应任务管理器绑定，run_id/audit_id/handoff_id 由模型工作流或健康 Harness 生成。消费方原样引用，不能将 run_id 替代 session_id。Harness 唯一修改健康 task_state/checkpoint，工具唯一生产 artifacts 中 Quant 结果及 tool_results.output；Core Agent 装配 audit_evidence/risk_handoff，Risk 仅写独立决策与回调，UI 只读消费。Contract version 由协议维护者冻结，不由消费者临时改写。

健康响应顶层必填 task_state/artifacts/tool_results/audit_evidence/risk_handoff；risk_handoff 可 null，成功交接时必须指向当前产物。模型 WorkflowRecord 已定义 session_id 但不是 required，未定义同名四个健康响应字段；其 status/model/proposed_action/audit 不能不经版本化适配就改名冒充统一。审计样例的 session_id 已存在，9 条事件六编号一致，不代表所有旧任务都补齐。HandoffPackage 必填 session_id 但允许 null，仍需 Owner 确认关联覆盖。

健康 TaskState 异常包括 WAITING_INPUT/BLOCKED/FAILED/CIRCUIT_OPEN，交接 HANDOFF_REQUIRED；模型等待 PENDING_RISK/PENDING_APPROVAL，终态或阻断包括 CANCELLED/EXPIRED/FAILED，Risk dispatch 可 FAILED。市场冲突 REVIEW_REQUIRED 是证据标记，不得据此生成交易动作。UI 需要保留原状态并展示恢复信息。

共享错误 core-agent-error.v1 顶层必填 error_contract_version/source_contract_version/operation/request_id/trace/error；error 必填 code/message/retryable/stage/recovery。trace 必填 error_contract_version/source_contract_version/request_id/task_id/session_id/run_id/audit_id/handoff_id，各未分配编号可为 null；旧字段保留兼容，未映射路由仍须 Backend 逐项确认，不声称所有 HTTP 错误都统一。

健康 Session/TaskState/Checkpoint/Audit 是进程内状态；模型本地文件或云端 Durable Object 持久化是不同能力，不能声称健康跨进程恢复已实现。Memory consent、范围、生命周期和清理归 Memory，不因审计持久化而改变。

## 本日验证与 Owner 接口需求

两仓库 npm run check 通过，npm test -- --test-reporter=tap 各 166/166 通过。python docs/daily-closeout-check-2026-10-17.py 各 23/23；检查 1 条当日合成公网留存记录和 9 条事件，做 required 键与关联相等检查，不是完整 JSON Schema 校验，不是新增公网运行。SHA256 和逐项结果在 daily-closeout-2026-10-17-trace.json。

Risk 须提供正式接收、可信身份与回写联合验收；Backend 须提供跨链路字段映射、健康持久化和跨实例幂等；Memory 须提供可信引用与撤回样例；Quant/Data 须确认版本/日期/余额/来源时效；UI 须确认等待、冲突、过期及失败恢复展示。Backend/Risk 的可信审批与 Safety Action Gateway 未完成，execution_allowed=false。百炼适配只验证替身，付费关闭、预算 0，线上 Workers AI；待确认清单未接网页、Memory 或正式任务创建。

## 文档版式验收

已嵌入可读架构图与模块调用时序图。已尝试 render_docx.py，环境缺少 LibreOffice soffice.exe，页面 PNG 未生成，逐页版式验收未完成；OOXML 与独立源图检查不能替代页面视觉验收。
