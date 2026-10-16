# Core Agent Daily Update · 2026-10-16

## 今日结论

今天完成了 Core Agent 主链路的统一 Contract 评审补齐和 Owner Bridge fail-closed 联调：模型提议、Risk Handoff、审批有效期、PAPER 模拟、Memory consent、Audit trace、幂等与异常状态可以在同一任务上核验；未配置正式 Risk Owner 时明确返回 503 并保留失败审计。真实执行仍关闭，不能称为正式 Risk 审核闭环或生产交易能力。

## 今日真实产出

- 今日有业务代码提交；本次日报只记录和同步已存在的实现与证据，没有修改 Quant、Memory、Risk 或 UI 业务实现。
- 完成 `model-review.v1`、`risk-handoff.v1` 和 `review-workflow.v1` 的字段与状态对齐：`schema_version`、`data_mode`、`execution_mode=PAPER`、`session_id`、`source_task_id`、`plan_id/plan_hash`、`policy_version`、`idempotency_key`、`memory_consent/memory_write_status` 以及统一 trace。
- 新增 `owner-bridge.v1` 与 `POST /api/review/risk-dispatch`：HMAC 签名、Owner 未配置时 503、失败写回同一 task、可按同一 proposal hash 重试；Risk/Approval 未配置正式密钥时标记 `DEMO_UNVERIFIED`，不伪装成正式身份。
- 审批有效期为 15 分钟；Risk 通过后仅进入审批或 PAPER 模拟，`execution_allowed=false` 固定。市场价格与新闻方向冲突继续只记录 `REVIEW_REQUIRED`，不生成交易动作。
- 维护联调资料：`core-agent-architecture.md`、`core-agent-sequence.md`、`contracts/README.md` 与运行时 Schema 继续作为源文件；本日报 DOCX 内嵌架构图和时序图。

## A. 已完成的核心接口

| 接口 / Contract | 版本 | 生产方 | 消费方 | 当前字段状态与证据 |
| --- | --- | --- | --- | --- |
| Agent 健康请求/响应 | `investment-agent.v1` | Backend / Core Agent | Harness / UI / Risk bridge | `request_id`、`task_id`、`session_id`、`task_state`、`artifacts`、`tool_results`、`audit_evidence`、`risk_handoff` 已实现并有语义检查；证据：`contracts/investment-agent.v1.schema.json`、`contracts/investment-contract.js`。 |
| 模型复核工作流 | `model-review.v1` / `review-workflow.v1` | Core Agent / Backend | Risk / Approval / UI | schema/data/execution/capability、plan/policy、幂等、审批过期、错误状态和统一 trace 已实现；证据：`docs/finance-lab-integration-review-followup-2026-10-16.md`。 |
| Risk Handoff / 回调 | `risk-handoff.v1` / `risk-callback.v1` | Core Agent / Risk | Backend / Audit / UI | task/request/session/run/audit/handoff/hash 绑定、重复回调与篡改阻断已验证；正式 Owner 身份和回写部署仍待确认。 |
| Owner Bridge 派发 | `owner-bridge.v1` | Core Agent / Backend | 独立 Risk Owner | HMAC、503 `RISK_OWNER_NOT_CONFIGURED`、`FAILED` 审计和同 task 重试已实现；证据：`contracts/owner-bridge.v1.schema.json`、`docs/public-owner-bridge-verification-2026-10-16.json`。 |
| 共享错误信封 | `core-agent-error.v1` | Backend / Core Agent | UI / Caller / Risk bridge | `error_contract_version`、`source_contract_version`、`operation` 和统一 trace 已实现；证据：`contracts/core-agent-error.v1.schema.json`、`docs/public-error-contract-verification-2026-10-16.json`。 |

字段归属：生产方写入并负责版本一致性，消费方只读使用；Risk、UI 不能把 `execution_allowed` 改为 true，Memory 不接管 Audit evidence，Quant 结果只能由既有工具生产。

## B. 可验证的集成进度

- 两个仓库 `chenchen/` 均执行 `npm run check`，exit 0。
- 两个仓库均执行 `npm test -- --test-reporter=tap`，**137/137 通过，0 失败**；覆盖 T01-T14 评审门禁、Owner Bridge 签名/失败重试、Risk/Approval 身份、HTTP 链路、Memory consent、Quant no-drift、取消和回调竞态。
- 两个仓库均执行 `git diff --check`，通过。
- 可复现命令：`cd chenchen; npm run check`；`cd chenchen; npm test -- --test-reporter=tap`；`cd chenchen; git diff --check`。
- Worker dry-run 打包通过；公网证据 `public-owner-bridge-verification-2026-10-16.json` 记录 `/review` 200、`risk-dispatch` 503 `RISK_OWNER_NOT_CONFIGURED`、`risk_dispatch.status=FAILED`、审计含 `dispatch_failed`、`execution_status=BLOCKED`、`execution_allowed=false`。该验证使用 `SYNTHETIC_REPLAY + PAPER`，不等于正式 Risk 联合验收。
- 追踪限制：健康链路可追踪 request/task/session/contract/audit；模型链路还需 Backend 明确 `run_id/audit_id` 到 session/task_state/artifacts/tool_results/audit_evidence 的适配，不能把 `run_id` 直接当 `session_id`。

## C. 需要其他 Owner 配合的阻塞项

- **Risk Owner**：提供正式 HTTPS 接收地址、服务身份/HMAC secret、`risk-callback.v1` 回写样例及验收证据；当前只证明了 fail-closed 派发。
- **Approval Owner**：提供可信审批身份、权限范围、多审批规则和签名密钥。
- **Execution Owner**：提供 Safety Action Gateway、执行前再检查和回执 Contract；在此之前真实执行保持关闭。
- **Backend Owner**：确认模型链路与健康链路字段映射、生产持久化、跨实例幂等和错误 envelope 的最终版本。
- **UI Owner**：确认 `PENDING_RISK`、`PENDING_APPROVAL`、`EXPIRED`、`FAILED`、`REVIEW_REQUIRED` 和 503 恢复展示，不能把前端 approval 当交易授权。
- **Memory / Quant / Data Owner**：确认可信 Memory 引用、Quant 版本与数据日期、市场来源/时效/冲突协议；本轮未改 Memory 规则，也未重新计算 Quant。

## 主链路与安全边界

Core Agent 当前消费既有 Quant 的 `diagnosePortfolio.metrics`、`generateCandidates.target_weights`、`runSimulation.comparisons`，只做 Contract 装配和审计关联。Memory consent、范围、生命周期和清理规则未改；主链路不会自动把输入写成长期记忆。请求进入 Contract 校验后装载 Session/Context，Harness 调用 Tools/Quant，写入 TaskState、Artifacts、ToolResults 和 Audit Evidence，再生成 Risk Handoff；Risk/审批等待、错误、取消和冲突都停在 `execution_allowed=false`。只读交接不代表 Risk 已完成审核。

## 下一步

先由 Risk、Approval 和 Backend 冻结正式身份、回写和跨链路 trace 映射，再补正式接收/拒绝/重试的联合验收；随后由 UI、Memory、Quant、Data 确认状态展示、可信引用、版本和数据新鲜度。

## DOCX 验收

已生成 `core-agent-daily-update-2026-10-16.docx`，内嵌架构图与模块时序图并完成 OOXML 结构检查。按文档技能运行 `render_docx.py`，环境缺少 LibreOffice `soffice.exe`，无法生成页面 PNG，因此版式逐页验收记录为未完成，未声称视觉验收通过。
