# Core Agent 主链路迭代 · 2026-10-15

本轮继续聚焦“看清钱的用途、识别计划冲突、把需要处理的事情跟进完成”。只修改 chenchen/，不重算 Quant，不修改 Memory 规则，不绕过 Risk，真实执行继续关闭。

## 这次做了什么

### 1. 任务找回

浏览器刷新后，页面可以从本机保存的虚构任务编号中恢复最近任务。恢复的是任务记录，不是审批身份，也不是可信记忆。页面会显示任务状态，并可打开完整运行记录。

任务记录只保留最近8个演示编号；服务端仍以 task_id 查询 Durable Object 中的正式记录。不同浏览器或清除本地存储后，需使用任务编号从接口查询。真实账户产品需要用户身份、租户隔离和权限控制后才能做跨设备任务列表，本轮没有假装已经具备这些能力。

### 2. 取消未完成任务

新增 POST /api/review/cancel。

请求包含 task_id、proposal_sha256、canceler、reason。结果是任务变为 CANCELLED，执行状态为 BLOCKED，execution_allowed=false，并增加 cancellation 和 task.cancelled 审计证据。

取消是终态。之后不能再用 Risk 或审批接口把同一任务恢复；需要继续时创建新任务。已经完成的模拟占用不能通过取消释放，避免用取消伪造资金回滚。

### 3. 重复确认不再制造假变化

相同现金和相同预留用途再次确认时，继续使用原 revision。只有资金金额或用途真正改变才增加 revision，并使旧任务在模拟前失效。用途数组按 purpose_id 做稳定比较，输入顺序变化不会被误判为变更。

### 4. UI 跟进体验

- “最近任务”默认收起，显示等待 Risk、等待审批、资金冲突、已模拟、已取消等状态。
- 未终结任务增加“取消这项任务”，取消后保留审计。
- GET 查询请求不再携带 POST body，刷新恢复和额度刷新走正确的 GET 语义。
- 原来“旧版持仓联调 Demo”、模型解释、Risk 交接和完整运行记录仍保留，默认收起。

### 5. 模型短暂失败的受控重试

模型服务遇到可重试的短暂错误时，同一次 review 默认最多自动再试 1 次。配置可用 `MODEL_MAX_ATTEMPTS` 调整，但服务端总尝试上限为 3；配置错误、有效 HTTP 200 中的非法模型协议和不支持的模型动作不会盲目重试。当前部署全部尝试共用 45 秒预算，重试前等待至少 250ms（下一次 500ms），HTTP 接入还遵守 Retry-After。等待会超出预算或已超时则直接结束，不额外再等 45 秒。

每次实际启动重试都会写入 `model.retry_scheduled` 审计事件；成功记录的 `model.model_response`、失败记录的 `model.response` 同时返回 `attempt_count` 和 `retry_count`，Risk Handoff 也携带这两个可选字段。旧记录没有计数时不补造。所有尝试都只产生拟议结果，最终失败仍然是 `MODEL_FAILED`，不会进入 Risk 审批或模拟执行。详细协议和复现方式见 [第二轮说明](core-agent-model-retry-2026-10-15.md)。

## 运行状态与职责边界

用户确认虚构用途 → Core Agent → 模型只提出建议 → Unified Risk → 人工审批 → 模拟前再检查 → SIMULATED 或 FUNDING_BLOCKED。用户也可以在终态前主动取消，形成 CANCELLED 和审计记录。

- Quant 仍只提供既有结果，Core Agent 不重新计算。
- Memory 仍不接受调用方文本直接升级为可信规则；虚构计划标记为 DEMO_USER_CONFIRMED_NOT_TRUSTED_MEMORY。
- Risk 仍是模型之后的统一边界；取消只是用户停止任务，不等于 Risk 决策。
- Approval 仍与同一 task_id 和 proposal_sha256 绑定。
- Execution 仍只做模拟，side_effects=false。

## 验证结果

- 第一轮自动测试：95/95 通过；本日第二轮重试加固后 103/103 通过，JavaScript 语法检查通过。
- 新增覆盖：相同计划重复确认、取消后的审计持久化、取消后 Risk 不能继续改写、刷新恢复任务、GET 查询语义。
- Contract JSON 可解析；model-review.v1 新增 CancellationRequest 和 CANCELLED 状态；risk-handoff.v1 增加取消状态与取消证据。
- 后端已部署：c2580383-d2c2-4d7f-9266-bc0a5653426a。
- 公网地址：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev。
- 公网取消路径已实测：任务 `review-task-49e241ef-73dc-4598-ae0c-221e23878813` 从 `PENDING_RISK` 变为 `CANCELLED`，重复取消返回 HTTP 409；完整证据见 public-cancel-verification-2026-10-15.json。Risk 与审批仍只能使用演示身份。
- 模型重试单测已实测：第一次返回 503，第二次成功；请求次数 2、`attempt_count=2`、`retry_count=1`，并出现 `model.retry_scheduled` 审计事件。持续失败仍保留失败记录并阻断执行，证据见 model-retry-verification-2026-10-15.json。

## 仍需团队配合

1. Risk Owner 提供正式接收地址、认证方式和独立回执。
2. Memory Owner 提供资金用途的可信来源、版本、有效期和撤回协议。
3. Approval Owner 提供真实审批人身份、角色权限和跨设备任务查询权限。
4. Execution Owner 定义真实账户的占用、释放、到期和补偿协议。

在这些条件完成前，演示环境不会打开真实付款、买卖或转账能力。
