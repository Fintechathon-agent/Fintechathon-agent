# Core Agent 模型服务交接与 Risk Golden Path

日期：2026-10-13  
范围：Core Agent 主链路、统一模型调用、Risk Handoff、审批、模拟执行、审计记录  
安全边界：不修改 Memory 规则，不重新计算 Quant，不绕过 Risk，不调用真实交易或付款网关。

## 交付结论

本轮把现有工作台的模型复核能力整理成一条可追踪工作流：

```text
工作台发起任务
  → 统一 Backend 调用模型
  → 保存模型原文和结构化拟议动作
  → Unified Risk Handoff
  → Risk APPROVE / REJECT / REQUEST_MORE_INFO
  → 必要时人工 APPROVE / REJECT
  → 仅允许模拟执行
  → 查询同一 task_id 的完整记录
```

每个阶段都关联同一个 `task_id`、`request_id`、`run_id`、`audit_id` 和 `proposal_sha256`。模型输出只能成为提议；`execution_allowed` 始终为 `false`。等待 Risk、等待审批、模型异常、Risk 拒绝、审批拒绝或拟议参数变化时，执行端都会阻断。

## 先确认已有能力

本轮开始前已有能力如下：

| 能力 | 原有状态 | 本轮处理 |
| --- | --- | --- |
| `/api/review` | 已有模型调用模块，但只返回模型复核结果，未串上 Risk、审批和模拟执行 | 保留接口入口，升级为统一 workflow 返回 |
| 模型服务 | 支持 Responses API / Chat Completions、JSON 输出、超时和错误返回 | 补充动作参数、模型配置回显和任务关联 |
| Risk Handoff | 投资健康检查已有只读 Handoff | 新增模型复核 Handoff，增加统一 Risk 决策状态 |
| 执行保护 | `/api/paper-trade/execute` 原来固定阻断 | 保留；新增的模拟执行只生成回执，不调用真实网关 |
| 审计 | 投资链路已有 audit_evidence | 模型工作流增加阶段事件，完整记录可按 task 或 run 查询 |

当前公网 Worker 已切换到 Cloudflare Workers AI，模型绑定为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`，并使用 Durable Object `ReviewService` 持久化 workflow 记录。公网回放已拿到真实模型响应；当前线上不需要 `MODEL_API_KEY`。

## 公网运行地址与部署责任

统一后端地址：

`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev`

健康检查：

`GET https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health`

模型工作流入口：

`POST https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review`

Risk 决策：

`POST https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review/risk-decision`

审批：

`POST https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review/approval`

模拟执行：

`POST https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review/simulate`

完整查询：

`GET https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review/task/{task_id}`

责任分工：

| 角色 | 负责事项 | 证据 |
| --- | --- | --- |
| Core Agent / Backend | 调模型、校验模型响应、生成 Handoff、绑定 task/run/audit | `workflow_version`、`model.model_response`、`risk_handoff` |
| Risk Owner | 对当前 proposal hash 做 APPROVE、REJECT 或 REQUEST_MORE_INFO | `risk_decision`、`risk.*` 事件 |
| Approval Owner | Risk 通过后记录人工审批 | `approval`、`approval.*` 事件 |
| Execution Gateway | 只接受已完成检查的模拟执行；真实执行仍阻断 | `execution`、`execution.simulated` |
| 部署 Owner | 在 Cloudflare 配置模型 Secret 并发布 Worker | `MODEL_API_KEY` Secret、Worker 部署日志 |
| UI | 发起任务、展示状态、提供 Risk/审批/模拟操作按钮 | `risk-workbench` 页面 |

## 模型配置要求

如果改用 OpenAI 兼容的 HTTP 模型，密钥只能放在 Cloudflare Worker Secret 或本地后端环境变量，不能放到 GitHub Pages、前端代码或仓库文件中。当前线上使用 Workers AI，不需要模型密钥。

Cloudflare 配置命令：

```powershell
npx wrangler secret put MODEL_API_KEY
npx wrangler deploy
```

当前线上变量配置：

```toml
MODEL_PROVIDER = "workers_ai"
MODEL_NAME = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
MODEL_RESPONSE_FORMAT = "json_schema"
MODEL_FALLBACK_TO_RULES = "false"
MODEL_DISABLE_RULE_FALLBACK = "true"
MODEL_TIMEOUT_MS = "45000"
MODEL_REQUESTS_PER_MINUTE = "6"
```

要求：

- 模型服务必须支持 HTTPS 和 Bearer Token。
- Responses API 返回 `output_text`，或能从 `output[].content[].text` 取到文本。
- 返回内容必须是指定 JSON Schema 的对象。
- `proposed_action` 只能是 `NO_ACTION`、`REQUEST_MORE_INFO`、`HOLD_FOR_REVIEW`、`FLAG_FOR_RISK`。
- 模型调用失败默认返回错误并阻断；规则降级只有显式 `allow_rule_fallback=true` 或配置开启时才允许，并且会标记 `source=rule_fallback`。
- 当前部署使用 Workers AI binding；`GET /health` 已返回 `model.configured=true`。
- 公网回放已验证 `model.source=model` 与 `model.model_response.call_succeeded=true`，并保存了脱敏运行日志。

## `/api/review` 请求样例

文件：`contracts/examples/model-review.request.json`

```json
{
  "request_id": "req-example-20261013-001",
  "kind": "bill",
  "source": "risk-workbench-demo",
  "text": "供应商账单 1280 元，付款截止日为 2026-10-20。请判断是否需要人工核对。",
  "requested_action": "判断这笔账单是否可以进入付款准备",
  "action_parameters": {
    "amount": 1280,
    "currency": "CNY",
    "due_date": "2026-10-20",
    "synthetic": true
  },
  "context": {
    "user_goal": "看清钱的用途并确认不会影响后续安排",
    "synthetic": true
  }
}
```

## `/api/review` 响应口径

成功响应是 `review-workflow.v1`，重点字段如下：

| 字段 | 含义 |
| --- | --- |
| `task_id` | 贯穿模型、Risk、审批、执行和审计的唯一任务号 |
| `model.model_response.raw_text` | 模型原始文本，可核查是否真的拿到模型响应 |
| `model.model_response.proposal` | 经过 Schema 校验后的模型提议 |
| `proposed_action.proposal_sha256` | 当前拟议动作和参数的指纹，防止审批后悄悄换参数 |
| `risk_handoff` | 交给统一 Risk 的证据包，初始为 `PENDING_REVIEW` |
| `approval` | Risk 通过后才会进入 `PENDING` |
| `execution` | 初始为 `BLOCKED`；通过审批后只能变成 `SIMULATED` |
| `audit.events` | 模型、交接、Risk、审批、阻断和模拟执行事件 |

完整示例见 `contracts/examples/model-review.response.json`。示例中的 ID 和哈希是脱敏夹具，不代表线上真实一次运行。

## Risk、审批和模拟执行接口

Risk 决策请求：

```json
{
  "task_id": "review-task-example-001",
  "proposal_sha256": "当前响应中的 proposal_sha256",
  "decision": "APPROVE",
  "reviewer": "risk-owner-example",
  "reason": "证据足够，进入人工审批"
}
```

`decision` 支持：

- `APPROVE`：Risk 通过；有动作的任务进入等待审批。
- `REJECT`：任务结束为 `REJECTED`，执行保持阻断。
- `REQUEST_MORE_INFO`：任务继续等待补充信息，执行保持阻断。

审批请求只有 Risk 已 `APPROVE` 才能成功：

```json
{
  "task_id": "review-task-example-001",
  "proposal_sha256": "当前响应中的 proposal_sha256",
  "decision": "APPROVE",
  "approver": "approver-example",
  "reason": "已核对付款用途和当前资金安排"
}
```

模拟执行请求：

```json
{
  "task_id": "review-task-example-001",
  "proposal_sha256": "当前响应中的 proposal_sha256"
}
```

成功时只返回 `mode=SIMULATED`、`side_effects=false` 的执行回执；真实执行授权仍然是 `false`。如果任务处于 `PENDING_RISK`、`PENDING_APPROVAL`、`REJECTED`、`MODEL_FAILED` 或哈希不一致，接口返回 `EXECUTION_BLOCKED` 或 `PROPOSAL_CHANGED`，并在同一个审计链中增加阻断事件。

## Golden Path 验收结果

本地 HTTP 测试使用可控的模型 Provider，验证的是工作流、Contract、风险边界和审计关联：

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 模型返回结构化响应 | 通过 | `model.model_response.raw_text`、`proposal` |
| 初始交给统一 Risk | 通过 | `risk_handoff.status=PENDING_REVIEW` |
| 未经 Risk/审批直接模拟 | 阻断 | `EXECUTION_BLOCKED` |
| Risk APPROVE 后等待审批 | 通过 | `status=PENDING_APPROVAL` |
| 审批 APPROVE 后模拟 | 通过 | `status=SIMULATED`、`side_effects=false` |
| Risk REJECT | 通过 | `status=REJECTED`、执行阻断 |
| 模型异常 | 通过 | `status=MODEL_FAILED`、Risk 和执行阻断 |
| proposal 参数变化 | 通过 | `PROPOSAL_CHANGED` |
| 完整记录查询 | 通过 | 按 `task_id` 和 `run_id` 均能读取 |

本地检查结果：

```text
npm run check  -> JavaScript syntax checks passed.
npm test       -> 73 tests passed, 0 failed.
node --test tests/cloudflare-review.test.mjs -> 6 tests passed, 0 failed.
```

运行日志保存在：`logs/core-agent-e2e-2026-10-13.jsonl`（本地链路验收）和 `logs/core-agent-e2e-public-2026-10-13.jsonl`（公网 Workers AI 回放）。日志只保留脱敏 ID、状态和证据，不保存任何密钥。

## 线上验收结果

代码、路由、真实模型调用和公网审计回放已完成。线上回放使用虚构账单完成了以下步骤：

1. 用 `contracts/examples/model-review.request.json` 调用公网 `/api/review`。
2. 保存返回的 `task_id`、`run_id`、`model_response.provider_response_id`、`model_response.raw_text` 和 `audit.events`。
3. 用同一个 `task_id` 依次调用 Risk、审批和模拟接口。
4. 调用 `/api/review/task/{task_id}`，核对五个关联键和最终 `execution.receipt`。
5. 将脱敏后的响应和运行日志追加到本目录的日报，不提交 API Key、真实账单或真实账户信息。最新线上回放证据见 `docs/public-review-recheck-response-2026-10-13.json`。

当前回放已经由 Workers AI 完成；如以后更换为外部模型，仍必须由拥有 Cloudflare Secret 配置权限的部署 Owner 配置密钥，模型密钥不通过聊天或 Git 提供。

## 版本与回溯

本轮只新增和修改 `chenchen/` 及 Worker 配置，未删除旧页面、旧 Contract、旧日报或旧提交。历史版本通过 Git commit 保留；当前个人仓库和团队仓库都应分别保留本轮提交，出现问题时可回到上一提交对照。
