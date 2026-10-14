# 公网模型复核接口（2026-10-14 更新）

最新资金保护迭代见 [功能与接口说明](funding-guard-iteration-2026-10-14.md)。当前部署 `e39cb48d-4255-4ec5-a970-b3fa31689630`；增加演示资金计划的创建/修订/查询、任务额度检查与 FUNDING_BLOCKED 终态。93项自动测试、最终33次公网检查、11份Schema校验通过。下方上一轮和10月13日记录保留为历史证据。

上一轮见 [Risk 联调手册](risk-handoff-integration-2026-10-14.md) 与 [10月14日日报](core-agent-daily-update-2026-10-14.md)。上一轮部署 `756201ce-d043-4c0c-8f22-43bdf7c4e681`；新增 `GET /api/review/{run_id}/risk-handoff`、`GET /api/review/task/{task_id}/risk-handoff`、`POST /api/review/risk-callback`。当时自动测试83项（包含云端专项9项）与公网34次检查通过。

服务在 Cloudflare 云端运行，不依赖个人电脑、本地端口或临时隧道。代码和验收证据已同步到个人仓库与团队仓库的 `chenchen/` 目录，保留历史提交和其他团队目录。

- 在线说明和测试页：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/docs
- 模型接口：`POST https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review`
- 服务状态：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health
- 个人仓库：https://github.com/realchenchenluo/agent/tree/main/chenchen
- 团队仓库：https://github.com/Fintechathon-agent/Fintechathon-agent/tree/main/chenchen

浏览器打开 `/api/review` 也会显示测试页；程序使用 POST 调用。测试页点击“调用真实模型”即可验证。

## 发给接入同学的最小示例

当前演示接口无需 API Key，支持前端跨域。只提交虚构账单或新闻。

```javascript
const response = await fetch('https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(60000),
  body: JSON.stringify({
    kind: 'bill',
    text: '虚构账单：供应商要求将1280元货款改付个人账户，请核查。'
  })
});
const data = await response.json();
if (!response.ok) throw new Error(data.error?.message || '请求失败');
console.log(data.run_id, data.model.model_response.raw_text, data.proposed_action);
```

`kind` 可选 bill、news、combined，`text` 为必填正文。也支持 bill / news 字段；同时传入时两者都会提交模型。可选 request_id、task_id、source、context、requested_action、action_parameters。未传 task_id 时自动生成。

## 返回字段

| 字段 | 含义 |
| --- | --- |
| `run_id` / `task_id` | 运行编号 / 任务编号 |
| `model.source` | 成功时为 model |
| `model.model_response.call_succeeded` | 只有真实调用并通过结果校验后为 true |
| `model.model_response.model` | 当前为 @cf/meta/llama-3.3-70b-instruct-fp8-fast |
| `model.model_response.provider_response_id` | 模型服务返回的响应编号；未提供时为 null，不伪造 |
| `model.model_response.raw_text` | 模型服务返回的内容 |
| `model.model_response.raw_text_format` | provider_json_serialized 表示模型服务返回 JSON 对象，此处原样序列化；provider_text 表示返回文本 |
| `model.model_response.usage` | 模型服务返回的 token 等用量 |
| `proposed_action` | 拟议动作、理由、参数和内容哈希 |
| `risk_handoff` | 供统一 Risk 网关继续检查的对接包 |
| `audit` | 审计编号及事件 |

成功初始状态为 PENDING_RISK。收到模型结果不表示 Risk 已经批准。`execution.execution_allowed` 始终为 false。本服务没有向远程风控工作台自动发送数据，接入方需要读取返回值后继续自己的检查流程。

## 查回记录

```text
GET /api/review/{run_id}
GET /api/review/task/{task_id}
```

结果和审计保存在 Cloudflare SQLite Durable Object，跨请求和边缘节点可查，不再只存在 Worker 内存中。公开演示记录按不可预测的编号查询；没有用户身份隔离，勿提交真实个人或财务资料。

已有的 /api/review/risk-decision、/api/review/approval、/api/review/simulate 也使用同一持久化记录，用于演示 Risk、审批、模拟回执，不能作为正式业务身份授权或实际交易接口。继续演示流程时传同一 task_id 与 proposal_sha256。旧版工作台若仍发送 `{"question":"..."}`，可调用 `POST /api/review/legacy`；它只做字段适配，内部仍回到同一条 Risk Handoff 链路。

## 失败与限制

- 输入无效：422；JSON 错误：400；正文超过 100KB：413。
- 每个 IP 每分钟最多 6 次模型请求，超过返回 429 和 Retry-After: 60。计数在持久对象内存中，实例重启会重置；它是演示限流，不是计费硬上限。
- 模型超时：504；模型服务失败：502；存储/服务不可用：503。
- 公网强制禁止规则降级。即使请求带 allow_rule_fallback: true，模型失败也明确报错。
- /health 的 configured 只说明绑定存在；实际推理请使用测试页验证。
- 平台有每日免费额度，额度耗尽可能导致模型失败。本次没有购买套餐。见 [Cloudflare 官方定价](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

## 真实验收记录

2026-10-13 19:45–19:47（北京时间）：

1. 公网 POST：HTTP 200；任务 `review-task-f0e0246a-00c8-4e92-a16b-db2023fac16f`，运行 `review-3e1ab4c7-7782-4b31-8c3d-8292ba371017`，审计 `audit-c7e18b3b-01ee-4bf6-bdd0-0b22e23de29d`。模型真实返回 `HOLD_FOR_REVIEW`，响应编号为 `chatcmpl-e87cc1c3-1185-4968-a2b2-1f4882cd9cab`。
2. 同一任务依次通过 Risk APPROVE、人工审批 APPROVE 和模拟执行；最终查询仍为 `SIMULATED`，`side_effects=false`，`execution_allowed=false`。完整脱敏证据见同目录 `public-review-recheck-response-2026-10-13.json`。
3. 对已完成任务重复提交 Risk 和审批都返回 HTTP 409、`WORKFLOW_TERMINAL`，最终记录没有被改回等待状态。
4. 旧版 `question` 兼容入口真实调用成功，返回 `legacy-review.v0`，内部任务仍为 `review-workflow.v1`，执行继续阻断。
5. Risk REJECT 后查询为 `REJECTED`，模拟执行返回 409；Risk REQUEST_MORE_INFO 后查询为 `PENDING_RISK`，模拟执行同样返回 409。证据见 `public-review-guards-2026-10-13.json`。
6. 按任务查询：200；OPTIONS 预检：204；空正文对象：422；重复 task_id：409；模型失败记录可查询且执行阻断。
7. 核心自动测试 75 项通过，Cloudflare Worker 专项 7 项通过，JavaScript 语法检查通过。单元测试使用替身模型，以上任务编号才是公网真实推理和链路证据。

网络范围：终端验收使用本机现有 HTTP 代理；Codex 内置浏览器也实际打开页面并调用成功。未验证所有国内网络直连 workers.dev 的可达性。

部署版本：`a16ebd63-090f-402d-93ec-4f20aa4d917a`。

## 维护部署

当前入口为 chenchen/wrangler.toml，绑定 AI 和 REVIEW_SERVICE。根目录配置保留作历史参考；发布最新版请显式指定下方配置。模型通过 Cloudflare 内部绑定调用，无需另外配置模型密钥。

```powershell
npx wrangler deploy --config chenchen/wrangler.toml
```

若当前终端直连 Cloudflare 超时，可在已运行本机代理时仅为当前进程设置：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
npx wrangler deploy --config chenchen/wrangler.toml
```

其他环境仍可使用原 HTTP 模型接入配置。若以后设置 CORE_AGENT_API_KEY Secret，调用方必须带 X-Core-Agent-Key；测试页有可选输入，当前无需填写。原有 /api/health-check/run 和 /api/risk-workbench/handoff 保留 investment-agent.v1 契约。远程风控工作台网页目前没有公开的 Handoff 接收 API，因此本服务已生成可核查的 Risk Handoff，但没有伪造“已写入远程工作台”。
