# Core Agent Owner Bridge 迭代记录 · 2026-10-16

## 这次补的缺口

上次主链路的模型、内部统一 Risk、必要审批、模拟执行和审计已经可以跑通；剩下的核心缺口是独立 Risk Owner 没有正式交接通道，Risk/Approval 的演示标签没有可信身份验证，外部服务不可用时也缺少可核查的失败记录。

## 已完成

### 1. 独立 Risk 交接适配层

- 新增 `owner-bridge.v1`。
- 新增 `POST /api/review/risk-dispatch`。
- Core Agent 发送的内容固定使用 `risk-handoff.v1`，包含原任务的 `task_id/request_id/session_id/run_id/audit_id/handoff_id/proposal_sha256`。
- 发送请求使用 HMAC 签名，响应只保存状态码和受限响应内容，不保存密钥。
- Risk 服务不可达、拒绝、超时或未配置时，都写入同一个任务的审计事件。

### 2. Risk 与 Approval 身份留痕

- 配置 `RISK_SERVICE_HMAC_SECRET` 后，Risk 决策和回调必须使用 `X-Risk-Signature`。
- 配置 `APPROVAL_SERVICE_HMAC_SECRET` 后，审批必须使用 `X-Approval-Signature`。
- 当前没有正式密钥时，系统明确记录 `DEMO_UNVERIFIED`；这保留了本地演示兼容性，也不会把演示标签说成正式身份。

### 3. 失败闭环

- Risk Handoff 发送失败会进入 `risk_dispatch.status=FAILED`。
- 失败不会改变 `PENDING_RISK`、不会创建审批、不会打开模拟或真实执行。
- 修复外部服务后可以使用同一任务和同一 proposal hash 重试；成功后记录 `SENT` 和上游状态码。

## 验证

- 完整本地回归：137/137 通过。
- Cloudflare Worker 专项：16/16 通过。
- 新增 Owner Bridge 测试：签名稳定性、签名篡改、演示身份、未配置服务、上游 202、失败重试、Risk/Approval 身份留痕。
- HTTP 新增验证：未配置 Risk Owner 时返回 `503 RISK_OWNER_NOT_CONFIGURED`，任务保留 `risk.handoff.dispatch_failed`，执行权限仍为 `false`。
- Worker dry-run 打包通过，包含 Durable Object、Workers AI 和新适配层。
- 公网 Worker 版本 `eff5cc9a-4d9c-47b5-a70a-a9f1adbb2790` 已验证：复核 200；未配置 Risk Owner 时派发 503 `RISK_OWNER_NOT_CONFIGURED`，任务 `risk_dispatch=FAILED`，审计和执行阻断均成立。证据见 `docs/public-owner-bridge-verification-2026-10-16.json`。

## 还需要外部 Owner 提供的东西

- Risk Owner：正式 HTTPS 地址、HMAC secret 或等价服务身份、接收后回写 `risk-callback.v1` 的部署证据。
- Approval Owner：审批身份来源、权限范围和正式签名密钥。
- Execution Owner：Safety Action Gateway 地址、执行前再检查和回执 Contract；在此之前不开放真实执行。

所以这次已经把“怎么接、怎么验签、怎么失败、怎么重试”做成可联调代码，但没有伪造外部 Owner 已经上线。旧版本和旧测试证据继续保留。
