# Core Agent 公网后端部署与 Risk 联调

## 先说结论

当前 Core Agent 已准备好公网 API，但公网地址必须由托管平台创建。GitHub Pages 只能发布前端，不能运行 Node.js 后端。

本仓库已经加入 `wrangler.toml` 和 Cloudflare Worker 入口，推荐直接部署到 Cloudflare Workers。Cloudflare 会给 Worker 分配 `workers.dev` 公网地址，前端和 Risk 工作台都可以通过 HTTPS 调用。

## Cloudflare 部署

在仓库根目录执行：

```powershell
npx wrangler login
npx wrangler deploy
```

`wrangler login` 会打开 Cloudflare 授权页；登录完成后，`wrangler deploy` 会读取根目录的 `wrangler.toml` 并发布 Worker。部署成功后终端会输出类似：

本次已经发布的公网地址：

`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev`

Cloudflare Workers 官方支持用 `wrangler login` 授权和 `wrangler deploy` 发布；本项目启用了 Node.js compatibility，让 Worker 可以复用现有 Core Agent 的 `node:crypto` 等模块。

也可以在 Cloudflare Dashboard 的 Workers & Pages 中导入仓库，构建配置以仓库根目录的 `wrangler.toml` 为准。

## 公网访问控制

当前演示默认不要求 API Key，以保持 GitHub Pages 的公开联调按钮可用。需要保护 POST 接口时，在 Cloudflare 配置 Secret：

```powershell
npx wrangler secret put CORE_AGENT_API_KEY
```

配置后，`/api/health-check/run` 和 `/api/risk-workbench/handoff` 必须携带 `X-Core-Agent-Key`；GitHub Pages 浏览器不应嵌入这个 Secret，正式接入应通过服务端代理或 Risk Consumer 调用。Worker 同时按客户端 IP 做默认每分钟 60 次的 best-effort 限流，超过后返回 429；Worker 实例之间的限流状态不共享，正式环境需要 Durable Object 或平台级 WAF 限流。

Worker 不记录请求正文；错误详情在返回前会限制深度/长度并脱敏敏感字段。以上是演示级保护，仍不能替代正式认证、审计日志、密钥轮换和隐私评审。

## 目前保留的其他部署配置

`render.yaml` 仍保留作为备用方案，但不需要使用 Render。GitHub Pages 的前端演示也继续保留，不会被 Worker 覆盖。

## Risk 工作台调用地址

本项目在线风控工作台已经使用上面的公网地址；Risk Owner 如果接入自己的前端或后端，也使用同一个地址：

```js
const response = await fetch(`${CORE_AGENT_BASE_URL}/api/risk-workbench/handoff`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ request })
});

const handoff = await response.json();
```

请求 `request` 必须遵守 `investment-agent.v1`，可以直接使用：

`chenchen/contracts/examples/health-check.request.json`

返回值中的 `risk_workbench` 是交给 Risk 的适配包，`agent_response` 是完整 Core Agent 响应。当前安全边界仍然固定为：

- `risk_workbench.decision.execution_allowed = false`
- Risk 需要独立复核，不能把 Agent 输出当成批准
- Core Agent 不重新计算 Quant，不修改 Memory 规则
- 不接收真实账户或真实交易数据

## 模型复核接口

如果需要让后端实际调用模型，对 Worker 配置以下变量或 Secret：

```powershell
npx wrangler secret put MODEL_API_KEY
npx wrangler secret put CORE_AGENT_API_KEY
```

可配置变量：

```toml
[vars]
MODEL_API_URL = "https://api.openai.com/v1/responses"
MODEL_API_STYLE = "responses"
MODEL_NAME = "gpt-5.6-terra"
MODEL_RESPONSE_FORMAT = "json_schema"
MODEL_FALLBACK_TO_RULES = "false"
```

然后调用：

```powershell
$body = @{
  kind = 'bill'
  source = 'synthetic-bill'
  text = '供应商账单 1280 元，付款截止日为 2026-10-20。'
  context = @{ currency = 'CNY'; synthetic = $true }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri 'https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review' `
  -Method Post `
  -Headers @{ 'X-Core-Agent-Key' = $env:CORE_AGENT_API_KEY } `
  -ContentType 'application/json' `
  -Body $body
```

返回结果包含 `workflow_version`、`task_id`、`run_id`、模型原文 `model.model_response.raw_text`、结构化 `proposed_action`、`risk_handoff`、`approval`、`execution` 和 `audit`。Risk Handoff 初始为 `PENDING_REVIEW`，`execution_allowed=false` 固定不变；这个接口不会把模型建议直接变成付款、交易或账户操作。Risk 决策、审批和模拟执行分别调用 `/api/review/risk-decision`、`/api/review/approval` 和 `/api/review/simulate`，每一步都必须传同一 `task_id` 与 `proposal_sha256`。`GET /api/review/{run_id}` 和 `GET /api/review/task/{task_id}` 可读取当前 Worker 实例内暂存的完整结果，但它不是持久化审计库，生产环境仍需接入正式存储。

模型没有配置或调用失败时，接口默认返回明确的错误，并生成 `MODEL_FAILED` 的阻断记录；只有请求显式传入 `allow_rule_fallback=true`，或配置 `MODEL_FALLBACK_TO_RULES=true`，才会返回带有 `source=rule_fallback` 和 `status=DEGRADED_RULE_FALLBACK` 的规则降级结果。完整字段、Owner 分工和验收结果见 `docs/model-service-risk-e2e-2026-10-13.md`。

## 先验证公网服务

部署完成后，在浏览器打开：

`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health`

应返回：

```json
{
  "status": "ok",
  "service": "core-agent",
  "contract_version": "investment-agent.v1"
}
```

然后调用：

```powershell
$body = Get-Content .\chenchen\contracts\examples\health-check.request.json -Raw
Invoke-RestMethod `
  -Uri "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/risk-workbench/handoff" `
  -Method Post `
  -ContentType "application/json" `
  -Body (ConvertTo-Json @{ request = (ConvertFrom-Json $body) } -Depth 30)
```

## 当前还需要 Risk Owner 确认的事情

公网后端上线不等于远程风控工作台已经自动接收。远程工作台还需要在自己的前端或服务端调用上面的 API，或者提供一个正式的 Handoff 接收接口。

目前已知的远程工作台页面没有公开的外部 Handoff 导入 API，所以本项目不能伪造“已经写入远程工作台”。拿到 Risk Owner 的接收地址后，再把 `risk_workbench` 的字段映射到对方的 `review_status`、`decision`、`execution_allowed`、`rejection_reason` 和审计字段。

## 数据与安全提醒

这是比赛演示后端，只使用虚构持仓和固定金融数据。公网地址一旦开放，任何知道地址的人都可能调用未加登录的演示 API；不要上传真实账户、身份证、银行卡、真实交易记录或真实财务数据。正式环境需要补充身份认证、限流、日志脱敏和密钥管理。
