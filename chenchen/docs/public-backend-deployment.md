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
  -Uri "https://你的服务地址.onrender.com/api/risk-workbench/handoff" `
  -Method Post `
  -ContentType "application/json" `
  -Body (ConvertTo-Json @{ request = (ConvertFrom-Json $body) } -Depth 30)
```

## 当前还需要 Risk Owner 确认的事情

公网后端上线不等于远程风控工作台已经自动接收。远程工作台还需要在自己的前端或服务端调用上面的 API，或者提供一个正式的 Handoff 接收接口。

目前已知的远程工作台页面没有公开的外部 Handoff 导入 API，所以本项目不能伪造“已经写入远程工作台”。拿到 Risk Owner 的接收地址后，再把 `risk_workbench` 的字段映射到对方的 `review_status`、`decision`、`execution_allowed`、`rejection_reason` 和审计字段。

## 数据与安全提醒

这是比赛演示后端，只使用虚构持仓和固定金融数据。公网地址一旦开放，任何知道地址的人都可能调用未加登录的演示 API；不要上传真实账户、身份证、银行卡、真实交易记录或真实财务数据。正式环境需要补充身份认证、限流、日志脱敏和密钥管理。
