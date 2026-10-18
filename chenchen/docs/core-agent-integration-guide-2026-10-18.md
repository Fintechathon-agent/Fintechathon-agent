# Core Agent 主链路联调手册 2026-10-18

本手册供 Agent、Backend、Risk、Memory、Quant、UI 对照接口联调。已实现两条主链路，已验证本地回归和跨对象追踪；新完整 Schema 检查发现 Risk 导出字段漂移，正式跨 Owner 审核闭环待确认。图像嵌入文末；运行时 Schema 是约束源，本文没有改变版本和实现。

## 架构职责与数据流

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


主数据流为 UI/Caller → Backend 版本校验 → Core Agent。健康链路由 Harness 装载 Session/Context、绑定 TaskState/Checkpoint、调用 Tools/现有 Quant，装配 artifacts/tool_results/audit_evidence 和只读 Handoff。模型链路由 ReviewWorkflowStore 装载关联字段并调用配置模型、绑定提议 hash、持久化任务/audit、生成 Handoff。两条链路共享责任边界，响应尚无完全统一的版本化适配。

## 模块调用时序与停止点

1. Caller → Backend：携带版本和 request_id；校验失败返回共享错误，尚未生成的 ID 为 null，停止调度。
2. 健康链路 → Harness：装载 Session/Context，核对 task/session 绑定；缺输入 WAITING_INPUT，绑定错配停止。
3. Harness → Tools/Quant：按 Checkpoint 复用或调用四阶段；保留原工具输出、版本与日期。有限重试后失败，停止后续阶段并保留审计。
4. Harness → TaskState/Audit：写 checkpoint.completed/result_refs 和阶段事件；Core Agent 装配健康响应，语义校验 ID 和产物引用，Handoff 为 PENDING_REVIEW 或 null。
5. 模型链路 → provider：创建 request/task/session/run/audit，调用既有配置模型并严格校验提议；有限次数与总超时，失败留审计，不静默换供应商。
6. Core Agent → Audit/Store：绑定提议 hash、六编号和证据，保存 PENDING_RISK。健康主链路不自动读取 Memory；任何 Memory 接口使用继续受既有 consent/范围限制，调用方文本不是可信记忆。
7. 导出包 → 接收方 Schema：本轮 source_task_id 与严格 HandoffPackage 不一致，按 Schema 接收的联调应在此停止；需 Backend/Risk 共同决定兼容策略，不能忽略校验继续声称接收成功。
8. 显式 Risk dispatch → 签名 Owner Bridge：接收未配置时返回 503、保留 FAILED 审计并等待。该结果本轮来自 10 月 17 日旧证据，不是新派发；重试必须绑定同 task/hash。
9. Risk → Backend callback：核对 ID/hash/可信身份；重复幂等，冲突拒绝，取消/过期不能恢复授权；正式 Owner 身份与回写仍待联合验收。
10. 必要可信审批后仅 PAPER；每次状态转换留审计。UI 查询任务/审计，前端 approval 不构成真实授权。execution_allowed=false；市场冲突仅 REVIEW_REQUIRED。

## 统一 Contract 必填字段和消费关系

以下 required 从当前 Schema 读取；可选不等于所有旧任务已具备，允许 null 不等于可省略字段。跨对象编号、hash 和引用还须语义检查。严格 Schema 仅证明其实际声明的约束，不能证明可信身份或授权。

### HealthCheckRequest

版本 investment-agent.v1；生产消费 Caller/Backend → Core Agent/Harness；证据 contracts/investment-agent.v1.schema.json。

必填：contract_version, request_id, operation, context, input。

### HealthCheckResponse

版本 investment-agent.v1；生产消费 Core Agent/Harness → Backend/Risk/UI；证据 contracts/investment-agent.v1.schema.json。

必填：contract_version, request_id, operation, trace, task_state, artifacts, tool_results, audit_evidence, risk_handoff。

### ReviewRequest

版本 model-review.v1；生产消费 Caller → Backend/ReviewWorkflowStore；证据 contracts/model-review.v1.schema.json。

必填：kind, text。

### WorkflowRecord

版本 review-workflow.v1 与 model-review.v1；生产消费 Backend/ReviewWorkflowStore → Risk/UI；证据 contracts/model-review.v1.schema.json。

必填：workflow_version, task_id, request_id, run_id, status, model, proposed_action, risk_handoff, risk_decision, approval, execution, audit。

### HandoffPackage

版本 risk-handoff.v1；生产消费 Core Agent → Risk；证据 contracts/risk-handoff.v1.schema.json。

必填：handoff_version, contract_version, workflow_version, schema_version, handoff_id, task_id, request_id, session_id, run_id, audit_id, data_mode, execution_mode, capability, plan_id, plan_hash, policy_version, owner, record_endpoint, workflow_status, status, decision, execution_allowed, proposal, reviewed_input, input_authority, model, evidence, approval, audit, memory_write_status, trace, callback。

### CallbackRequest

版本 risk-callback.v1；生产消费 Risk → Backend；证据 contracts/risk-handoff.v1.schema.json。

必填：handoff_id, task_id, request_id, run_id, audit_id, reviewer, reason, callback_version, proposal_sha256, decision。

### SharedErrorEnvelope

版本 core-agent-error.v1；生产消费 Backend/Core Agent → Caller/UI/Risk bridge；证据 contracts/core-agent-error.v1.schema.json。

必填：error_contract_version, source_contract_version, operation, request_id, trace, error。

## 字段生产权与不可修改边界

- contract_version/schema_version/workflow_version：对应 Contract 维护者冻结，Backend 校验并传递，Risk/UI 不临时改写版本。共享错误另有 error_contract_version/source_contract_version。
- request_id：Caller 或 Backend 入口确定；Core Agent 绑定当前请求，Risk/UI 引用不得改写。同任务重复请求可有新 request_id，历史审计 payload 保留原请求，不能覆盖历史证据。
- task_id/session_id：对应 Harness/ReviewWorkflowStore 创建或绑定；Backend/Risk/UI 消费不可替换关联。健康 session 是状态绑定；模型 session_id 可选且可 null，不能用 run_id 冒充 session。
- task_state/checkpoint：健康 Harness 唯一推进，Backend/UI/Risk 只读；completed/result_refs 必须引用存在的工具结果。模型 WorkflowRecord 使用 status，不具同名 task_state；映射待 Backend。
- artifacts/tool_results：现有工具/Quant 生产数值、版本、日期，Core Agent 组织引用；其他消费者不重新计算、不改原值。模型 proposed_action/model 并非已标准化的同名字段。
- risk_handoff：Core Agent 根据当前产物与审计装配，Risk 消费并通过独立回调产生决策；UI 不批准、不改 hash。健康 Handoff 与模型 HandoffPackage 不可直接混用。
- audit_evidence：健康 Harness/Core Agent 生产，模型用 audit.events。run_id/audit_id/handoff_id 按所属任务链生成，消费者原样引用，事件不可改写；模型存储持久化不证明健康 Session/Checkpoint 已跨重启持久化。
- error envelope：Backend/Core Agent 生产，Caller/UI 消费，code/message/retryable/stage/recovery 必填；trace 必填版本及 request/task/session/run/audit/handoff，未分配时可 null。不能凭 UI 文案将失败改为成功。
- source_task_id：模型记录/导出器提供的来源关联；当前 HandoffPackage 未声明，additionalProperties=false。生产者与协议冲突已验证；归属、nullable、消费者必需性和版本/兼容方案待 Backend/Risk 确认，未擅自纳入统一协议。

## 异常与追踪限制

健康 TaskState 的 WAITING_INPUT/BLOCKED/FAILED/CIRCUIT_OPEN 阻断后续阶段；HANDOFF_REQUIRED 是交接停止点。模型状态以 Schema enum 为准，包括 PENDING_RISK/PENDING_APPROVAL/READY_FOR_SIMULATION/SIMULATED/REJECTED/EXPIRED/MODEL_FAILED/FUNDING_BLOCKED/CANCELLED；risk_dispatch.status 另可 FAILED，不将它混作 WorkflowRecord.status。价格新闻冲突只为 REVIEW_REQUIRED 待复核。

健康响应必填 task_state/artifacts/tool_results/audit_evidence/risk_handoff，后者可 null。模型 session_id 未列 required，四个健康字段未定义同名映射。HandoffPackage.session_id 是必填但可 null；回调必填 request/task/run/audit/handoff，不要求独立 session_id，须回查存储记录，不能宣称回调验证六个必填 ID。Audit trace 可含 session，仍需检查其绑定。

结构 Schema 允许失效 checkpoint.result_refs 字符串，本轮结构校验通过而现有语义校验拒绝，说明必须同时验结构与引用。新检查的同进程 Checkpoint 复用不证明跨重启恢复；留存模型合成记录和九事件追踪不证明所有历史任务都完整。Memory、Risk、审批身份和真实执行网关不由审计字段数量证明。

## 今日验证和 Owner 验收要求

两仓库 main 基线 npm run check exit 0；npm test -- --test-reporter=tap 各 193/193 通过。团队以 c243950 的 git archive 独立副本验证；原工作区 200/200 含协作者未提交测试，不作为已提交 main 功能。python docs/daily-closeout-check-2026-10-18.py exit 1，31/32 检查通过；7 个正向对象完整 Schema 校验 6 通过 1 失败，唯一失败为导出包 source_task_id。新合成健康成功/复用/失败可追踪，旧模型九事件六编号与 hash 对齐。证据和复现环境见同日日报、daily-closeout-2026-10-18-trace.json 与脚本。未进行新增公网/模型/Risk 请求。

Backend/Risk 先共同确认 source_task_id 的兼容与版本方案，提交可校验的收发样例；Risk 再提供正式身份、接收、回写及重复/拒绝/重试联合验收。Backend 补跨链路字段映射及健康持久化；Memory 给可信引用与撤回样例；Quant/Data 冻结版本/日期/来源时效；UI 确认等待、失败、冲突及恢复。真实执行保持 false，前端 approval 不替代交易授权。

## 文档版式验收

Word 内嵌可读架构图与模块调用时序图。已尝试 render_docx.py，环境缺少 LibreOffice soffice.exe，未生成页面 PNG，逐页版式验收未完成；OOXML 与源图检查不能代替页面验收。
