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
- risk_handoff：仅在 HANDOFF_REQUIRED 时生成，包含 Risk 所需的证据 ID；execution_allowed 永远为 false，不能把 Agent 输出当作交易授权。

请求可以附带可选的 `market_context`。它只表示一份有来源和数据日期的市场简报上下文，用于异常标记和 Risk 复核，不会覆盖或重新计算 Quant 的组合收益、回撤、相关性和模拟结果。价格与消息方向冲突时只生成 `REVIEW_REQUIRED`，不自动转换为交易动作。

Risk 只消费 risk_handoff.evidence 指向的结果，并按 contract_version、task_id、session_id 和 request_id 关联记录。前端传来的 approval 字段不是 Risk 决策，也不能绕过 Safety Action Gateway。

## 示例与地址

- 请求示例：contracts/examples/health-check.request.json
- 响应示例：contracts/examples/health-check.response.json
- 在线运行时 Schema：/contracts/investment-agent.v1.schema.json
- 在线运行时请求示例：/contracts/examples/health-check.request.json
- 在线运行时响应示例：/contracts/examples/health-check.response.json
- 市场简报测试夹具：data/market-brief-2026-10-08.json

PowerShell 调用示例：

    $body = Get-Content .\contracts\examples\health-check.request.json -Raw
    Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4175/api/health-check/run -ContentType 'application/json' -Body $body

缺少 contract_version、request_id、context 或 input 时，Backend 返回 422 INVALID_CONTRACT。不要在生产代码中拼接旧的裸字段请求。
