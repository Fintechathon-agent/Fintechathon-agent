# Finance Lab 集成评审跟进 · 2026-10-16

来源：`Finance_Lab_Integration_Review_2026-10-13(1).pdf`。文档中的旧仓库路径、Owner 名称、公开地址和测试编号属于评审材料；本次只把其中的接口边界、状态约束和验收要求映射到当前 Core Agent，不把评审材料中的外部仓库当成当前实现。

## 这次补齐了什么

### 1. 统一模型到 Risk 的 Contract

`model-review.v1` 的输入和返回任务现在明确携带：

- `schema_version`、`data_mode`、`execution_mode=PAPER`、`capability`；
- `session_id`、`source_task_id`、`portfolio_snapshot_id`、`risk_profile_version`；
- `plan_id`、`plan_hash`、`policy_version`、`idempotency_key`；
- `memory_consent` 和 `memory_write_status`。

同一组字段会进入 `review-workflow.v1` 和 `risk-handoff.v1`，Risk、审批、模拟执行和审计可以使用同一份任务关联信息。Core Agent 不重新计算 Quant，模型输出只作为拟议动作。

### 2. Risk Handoff 与执行保护

- 模型调用成功后先创建 `PENDING_RISK`，`execution_allowed=false`。
- Risk 只能使用当前 task 的 `proposal_sha256/plan_hash`；不同 task、request、run、audit、handoff 或 hash 的回调都会被拒绝并写入审计。
- Risk 通过后，如果需要审批，进入 `PENDING_APPROVAL`；审批通过后只进入模拟执行。
- 真实交易或付款仍然没有入口；已有 `GATEWAY_NOT_CONNECTED` 阻断继续保留。
- 计划、审批和模拟执行都绑定同一个 hash；参数变化需要重新创建任务。

### 3. 审批有效期与异常状态

Risk 通过后生成 15 分钟的 `approval.expires_at`。过期后任务进入 `EXPIRED`，审批和模拟执行都被阻断，必须创建新任务重新经过 Risk 和审批。模型超时、模型服务不可用、未知执行状态和持久化失败继续返回错误或阻断状态，不显示成功。

### 4. 幂等和 Memory/Audit

- 请求体或 `Idempotency-Key` 请求头可以指定幂等键。同键同内容返回原任务，同键换内容返回 `IDEMPOTENCY_CONFLICT`。
- 审计事件新增同一份 trace：`request_id/task_id/session_id/run_id/audit_id/handoff_id`，避免只靠某一个编号串联记录。
- Memory 规则没有改动。没有明确同意时不写入；明确同意且配置了写入器时，模拟完成后记录 `memory_id`；没有写入器时标记 `UNAVAILABLE`，不伪造成功。
- 规则降级不再由请求单独打开，必须同时满足后端显式开启和请求显式声明；线上模式默认失败即失败。

## 验收结果

新增 `tests/finance-lab-review-gate.test.js`，按评审文档的 T01-T14 验证：

| 编号 | 验证内容 | 结果 |
| --- | --- | --- |
| T01-T02 | 缺字段、契约版本、数据/执行模式和策略版本 | 通过 |
| T03-T04 | Risk 后审批有效期、审批前执行阻断 | 通过 |
| T05-T06 | 显式 Memory 同意、Handoff 与 Audit 同一 trace | 通过 |
| T07-T10 | Risk 拒绝、PAPER 边界、hash 防篡改、回调串单 | 通过 |
| T11-T12 | 降级开关、审批过期后的阻断 | 通过 |
| T13-T14 | 幂等键冲突、模型失败后的审计阻断 | 通过 |

当前团队仓库 `chenchen/` 结果：

- `npm run check`：通过；
- `npm test -- --test-reporter=tap`：129/129 通过，0 失败；
- 两份新 Schema 均可正常解析；
- 旧测试和旧版本文件均保留。

## 仍未宣称完成的部分

这次完成的是 Core Agent 自有主链路的契约和保护。正式 Risk 服务身份、正式审批身份、Safety Action Gateway、跨系统真实 Memory 持久化和联合验收仍需要对应 Owner 提供接口与证据。当前 `execution_allowed` 永远为 `false`，PAPER 模拟回执不等于真实交易。

## 变更文件

- `integrations/model-review.js`
- `integrations/review-workflow.js`
- `integrations/risk-handoff.js`
- `server.js`
- `deployment/worker.js`
- `deployment/review-docs.js`
- `contracts/model-review.v1.schema.json`
- `contracts/risk-handoff.v1.schema.json`
- `contracts/examples/model-review.request.json`
- `contracts/examples/model-review.response.json`
- `contracts/README.md`
- `tests/model-review.test.js`
- `tests/finance-lab-review-gate.test.js`

本轮只修改团队仓库和个人仓库的 `chenchen/` 对应文件；旧提交可直接回溯。
