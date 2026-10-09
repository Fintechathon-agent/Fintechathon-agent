# Core Agent Daily Update

> 用途：每天 22:00 前更新一次，供团队同步主链路进展。本文档只记录 Core Agent 主链路，不替代 Risk、Memory、Quant 或 UI 的专项日报。

## 2026-10-09

### 今日结论

Core Agent 主链路当前处于“统一 Contract 已落地，等待继续扩展联调”的阶段。投资健康检查主流程已经能够从版本化请求进入 Backend，经过 Harness 调用现有 Tools / Quant 结果，生成任务状态、分析产物、工具证据和 Risk Handoff；到达 Risk 边界后停止，不产生执行授权。

### 今日完成

- 明确 Core Agent 主链路 DRI 范围和非职责边界。
- 明确 Core Agent 不重新计算 Quant，不修改 Memory 规则，不绕过 Risk。
- 保留 `investment-agent.v1` 作为投资健康检查主流程的公共 Contract。
- 保留 `request_id`、`task_id`、`session_id` 和证据 ID 的关联要求。
- 保留 `risk_handoff.execution_allowed = false` 的安全边界。
- 建立本 Daily Update 文档，后续按日期追加，不覆盖历史记录。

### 当前主链路状态

| 阶段 | 当前状态 | 说明 |
| --- | --- | --- |
| 请求进入 | 已完成 | Backend 接收版本化 Contract 请求 |
| Session / Context | 已完成 | 支持 task、session 和演示数据模式 |
| Harness 编排 | 已完成 | 澄清、校验、诊断、候选、模拟、交接流程已串联 |
| Tools / Quant | 已接入现有结果 | Core Agent 调用现有工具结果，不复制计算逻辑 |
| Contract | 主流程已完成 | 已覆盖投资健康检查请求、响应、错误和 Risk Handoff |
| Risk 交接 | 已完成演示链路 | 生成证据引用，固定不允许执行 |
| 独立 Risk Consumer | 待接入 | 当前还没有独立 Risk 服务消费 Handoff |
| UI 对接 | 当前可用 | UI 已消费投资主流程返回结果；其他接口仍需继续统一 |

### 接口对齐重点

- Agent 发送：`contract_version`、`request_id`、`operation`、`context`、`input`。
- Backend 返回：`task_state`、`artifacts`、`tool_results`、`risk_handoff`。
- Risk 读取：`risk_handoff.evidence` 指向的持仓快照、健康报告、候选方案和模拟结果。
- 所有联调日志必须保留：`contract_version`、`request_id`、`task_id`、`session_id`。
- 旧的裸字段请求不能继续作为正式接口使用，会被拒绝为 `INVALID_CONTRACT`。

### 安全边界

- Core Agent 不重新计算 Quant。
- Core Agent 不修改 Memory 的 consent、范围、生命周期和清理规则。
- Core Agent 不绕过 Risk，不接受前端 approval 作为交易授权。
- 当前演示不执行真实交易，`execution_allowed` 固定为 `false`。

### 验证结果

- JavaScript 语法检查：通过。
- 自动化测试：47 项通过。
- 页面与静态资源 Smoke Test：通过。
- 团队仓库和个人仓库：代码状态已同步。

### 当前风险与阻塞

1. Contract 目前主要覆盖投资健康检查主流程，组合导入、诊断、策略生成和模拟等接口还需要继续版本化。
2. 独立 Risk Consumer 尚未接入，当前是生成并验证 Handoff，还没有外部 Risk 服务的真实消费链路。
3. 当前仍使用虚构演示数据，不能作为真实投资决策或交易系统。

### 下一步

- 与 Risk 确认 Handoff 的消费字段、审核状态和回写方式。
- 与 Quant 确认只消费现有计算结果，不在 Core Agent 增加重复计算。
- 与 Memory 确认 Core Agent 只调用既有 Memory 接口，不修改授权和生命周期规则。
- 为剩余投资接口补充版本化 Contract 和错误信封。
- 与 UI 对齐主流程字段，确保页面不依赖未声明的内部字段。

## 后续日期模板

复制下面的模板，追加到本文档顶部或最新日期之后，保留所有历史记录：

```markdown
## YYYY-MM-DD

### 今日结论

一句话说明主链路推进到了哪里。

### 今日完成

- 

### 当前主链路状态

| 阶段 | 当前状态 | 说明 |
| --- | --- | --- |
| 请求进入 |  |  |
| Session / Context |  |  |
| Harness 编排 |  |  |
| Tools / Quant |  |  |
| Contract |  |  |
| Risk 交接 |  |  |
| UI 对接 |  |  |

### 接口对齐重点

- 

### 安全边界

- 未重新计算 Quant：是 / 否，说明：
- 未修改 Memory 规则：是 / 否，说明：
- 未绕过 Risk：是 / 否，说明：

### 验证结果

- 

### 当前风险与阻塞

1. 

### 下一步

- 
```

