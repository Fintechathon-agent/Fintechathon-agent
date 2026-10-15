# Core Agent 双链路联调手册 2026-10-15

状态：已实现 / 已验证 / 待 Owner 确认分别记录，文档不升级运行时 Schema。

## 架构

- UI / Caller  →  Backend HTTP  →  Contract 校验  →  Core Agent 编排
- 健康检查 investment-agent.v1：Harness → Session / Context → TaskState / Checkpoint
- Harness → Tools / 既有 Quant → artifacts / tool_results → Risk Handoff
- 模型复核 model-review.v1：ReviewWorkflowStore → 模型提议 / 参数指纹 → Risk Handoff
- 模型任务：request / task / run / audit；未定义 session_id，不等同 Harness Session
- Audit：健康链路进程内；模型链路本地文件或云端 Durable Object 持久化
- Memory：独立会话接口；主健康链路不自动读取；调用材料不等于可信记忆
- Risk 导出包 → 独立 Risk Owner 待认证联调；演示回调 → 必要审批 → 无副作用模拟
- 停止点：等待 Risk / 审批；取消、失败、冲突均阻断；真实 execution_allowed=false
- UI 只消费状态与证据；Quant 计算归原工具；Memory consent 和生命周期归 Memory

## 模块时序

- 01 UI → Backend：版本化健康请求 / 模型复核请求；非法输入停止并返回错误
- 02 健康链路：校验市场夹具 → 装载 Session / Context → 绑定 TaskState
- 03 Harness → Tools / Quant：按 checkpoint 复用或运行四阶段；失败最多重试一次
- 04 Harness → Audit：阶段与 checkpoint；装配 trace / artifacts / tool_results / Handoff
- 05 模型链路：创建 request / task / run / audit → 调用模型；默认总尝试 2 次
- 06 模型重试：总预算 45 秒含退避 / Retry-After；耗尽 MODEL_FAILED 并保存失败证据
- 07 模型成功 → 提议及 proposal_sha256 → PENDING_RISK → 持久化 → 返回 UI
- 08 Risk 读取导出包；正式独立接收和认证待 Owner；测试用演示 callback
- 09 callback：核对 handoff / task / request / run / audit / hash → 决定及回执原子保存
- 10 完全相同回调 → DUPLICATE 返回当前状态；改判定证据 409；非法输入 422
- 11 Risk 通过 → 必要审批 → 仅模拟；取消后旧回调不能恢复；真实执行始终关闭
- 12 UI 查询 task / run / audit；Memory 无自动长期读写；冲突市场上下文仅待复核

## 统一 Contract 必填字段

- investment-agent.v1.schema.json / HealthCheckRequest：contract_version, request_id, operation, context, input
- investment-agent.v1.schema.json / HealthCheckResponse：contract_version, request_id, operation, trace, task_state, artifacts, tool_results, audit_evidence, risk_handoff
- investment-agent.v1.schema.json / HealthCheckErrorResponse：contract_version, request_id, operation, error
- model-review.v1.schema.json / ReviewRequest：kind, text
- model-review.v1.schema.json / WorkflowRecord：workflow_version, task_id, request_id, run_id, status, model, proposed_action, risk_handoff, risk_decision, approval, execution, audit
- model-review.v1.schema.json / RiskDecisionRequest：task_id, proposal_sha256, decision, reviewer, reason
- model-review.v1.schema.json / ApprovalRequest：task_id, proposal_sha256, decision, approver, reason
- model-review.v1.schema.json / CancellationRequest：task_id, proposal_sha256, canceler, reason
- risk-handoff.v1.schema.json / HandoffPackage：handoff_version, contract_version, workflow_version, handoff_id, task_id, request_id, run_id, audit_id, owner, record_endpoint, workflow_status, status, decision, execution_allowed, proposal, reviewed_input, input_authority, model, evidence, approval, audit, callback
- risk-handoff.v1.schema.json / CallbackRequest：handoff_id, task_id, request_id, run_id, audit_id, reviewer, reason, callback_version, proposal_sha256, decision
- risk-handoff.v1.schema.json / CallbackResponse：callback_version, callback_status, handoff, workflow

## 字段归属与追踪限制

健康链路 request_id/task_id/session_id/contract_version/audit_evidence 与 checkpoint 可关联；模型链路 request_id/task_id/run_id/audit.audit_id 可关联，但无标准 session_id、task_state、artifacts、tool_results、audit_evidence 字段。禁止把 run_id 当 session_id，或把模型 audit 默认为旧 audit_evidence。

Caller 产生输入与可选 request/task 编号；Backend/Store 创建缺省编号，消费者不能改写已绑定编号或 proposal_sha256。Harness 独占 Session/TaskState/Checkpoint 写入；Tools/Quant 独占计算产物；UI/Risk 不能改 artifacts 或工具数值。Risk 产生正式决定；Core 只验证绑定并保存，不自行批准。audit 事件由对应 Store/Harness 写入，UI 只读；调用方 context 不是 Memory。

## Error envelope 与异常

健康错误：contract_version/request_id/operation/error 必填，trace 可选；error.code/message/retryable/stage/recovery 必填。模型 HTTP 错误当前有 review_version/error/trace/workflow；trace 为 contract_version/request_id/task_id/run_id/audit_id，可为空；并无独立统一错误 Schema，404 等路由仍有简化 error。Backend Owner 待冻结跨路由错误 Contract。

健康状态：WAITING_INPUT、BLOCKED、FAILED、CIRCUIT_OPEN、HANDOFF_REQUIRED。模型状态：PENDING_RISK、PENDING_APPROVAL、READY_FOR_SIMULATION、SIMULATED、REJECTED、MODEL_FAILED、FUNDING_BLOCKED、CANCELLED。完全相同有效审批重试复用原记录；变更人员/理由/决定 409；空白或超长理由 422。创建任务未新增幂等键，丢响应应先查询，不能盲目重建。

## 验证与待确认

本次两个仓库 chenchen 均执行 npm run check（exit 0）；node --test tests/*.test.js tests/*.test.mjs（113/113，fail 0）；node scripts/verify-model-retry.js（2 场景通过）；node scripts/verify-decision-integrity.js（2 场景通过）；git diff --check（exit 0）。

金融数据测试：2026-10-08/09 固定市场夹具、重复观察拒绝、价格与新闻冲突 REVIEW_REQUIRED 和 Quant 无漂移测试通过；不是 2026-10-15 实时行情验收。健康链路消费现有 diagnosePortfolio metrics、generateCandidates target_weights、runSimulation comparisons；本次模型故障脚本不调用或重算 Quant。未修改 Memory 规则。

当前已实现并验证到 Core Agent 自有交接、演示 Risk/审批、取消保护及无副作用模拟；独立 Risk 正式认证与审核闭环尚未验收。execution_allowed=false，前端 approval 不是交易授权。

- Risk：确认独立接收地址、服务身份/签名、六个关联字段和 409/422/重复回调语义；当前仅演示标签。期望提供正式接收与回写样例及联调验收。
- Backend：确认两套追踪字段映射、生产身份与跨实例事务、实际网络可达性。模型 Schema 没有 session_id/task_state/artifacts/tool_results/audit_evidence，不能假称统一；期望版本化适配方案。
- UI：确认冲突时展示原审批人和理由，不改理由自动重试；取消后保持终态。期望 409/422、失败和任务找回验收记录。
- Memory：确认资金用途可信引用、版本、有效期及撤回；调用方 context 仍是 UNVERIFIED_CALLER_INPUT。期望接口样例；consent、范围、生命周期和清理规则保持原样。
- Quant / Data：确认现有 metrics、target_weights、comparisons 的版本与数据日期，以及市场来源、时效和冲突复核协议。期望版本化数据样例；本轮仅固定夹具回放。
- Risk / Backend（审批与执行）：提供受信任审批身份、权限及 Safety Action Gateway；执行前额度检查与跨任务隔离待联合确认，真实执行继续阻断。

DOCX 版式验收未完成：两仓库日报与联调手册均实际运行 render_docx.py，全部 exit 1；原因 LibreOffice soffice.exe was not found on PATH。已检查 DOCX 结构和两幅原始图像，但无页面 PNG，未完成逐页视觉验收。日志见 daily-closeout-2026-10-15-render.txt。

可复现字段检查：在 chenchen 下执行 python docs/daily-closeout-check-2026-10-15.py；对已保存的本次真实合成输出复核 required 键和四类追踪值。重新产生合成输出可运行 node scripts/verify-model-retry.js 与 node scripts/verify-decision-integrity.js。
