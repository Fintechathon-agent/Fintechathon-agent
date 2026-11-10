# Core Agent Integration Guide 2026-11-10

## 用途

固定 Core Agent、Backend、Harness、Session、Context、TaskState、Tools、Quant、Memory、Risk、UI 的职责边界和停止点，供后续统一接口联调。

## 架构与数据流

Core Agent 创建 request_id/task_id/session_id；Backend 校验版本和身份；Harness 调度只读 Tools 与既有 Quant；Memory 只在既有规则内读取；Risk Handoff 进入独立审核边界；UI 只展示服务端状态。异常和冲突均停止在可审计状态，execution_allowed=false。

## 模块调用时序

请求进入 → Contract 校验 → Session/Context 装载 → Harness 调度 → Tools/Quant → 受限 Memory 读取 → TaskState/Checkpoint → Risk Handoff → Risk 审核等待 → 回调或异常重试 → Audit Evidence 写入。

## 字段归属

request_id、task_id、session_id、contract_version、task_state、artifacts、tool_results、risk_handoff、audit_evidence 和 error envelope 的必填、生产、消费与修改权限以运行时 Schema 为准；消费者只能引用生产方字段。

## 已实现 已验证 待 Owner 确认

已实现四份核心 Schema、只读 Handoff、错误 envelope 和同任务重试边界；已验证两仓库 284/284、Schema 4/4 和固定金融夹具；待 Risk/Backend、UI、Memory、Quant/Data 确认联合验收和版本样例。

## 追踪限制

本日可追踪 request_id、task_id、session_id、contract_version、audit_evidence；WorkflowRecord.session_id 可选，健康 Session/Checkpoint 仍为进程内状态，跨实例持久化尚未冻结。
