# Core Agent 模块调用时序

2026-10-10 修订：按 core/harness.js 与 server.js 的实际顺序描述；独立 Risk 审核回写仅为待接入步骤。

~~~mermaid
sequenceDiagram
    participant UI as UI / Caller
    participant API as Backend
    participant C as Contract Validator
    participant H as Core Agent / Harness
    participant S as Session / Context / TaskState
    participant M as Memory
    participant Q as Tools / Quant
    participant AU as Audit Evidence
    participant R as 独立 Risk（待接入）
    UI->>API: POST /api/health-check/run
    API->>H: runHealthCheckContract(request)
    H->>C: assertHealthCheckRequest
    alt Contract 非法或市场夹具非法
        C-->>API: INVALID_CONTRACT / INVALID_MARKET_CONTEXT
        API-->>UI: HTTP 422 / error envelope
    else 输入可接受
        Note over H: 可选市场上下文先校验；不进入 Quant 公式
        H->>S: 创建或按 task_id 查找任务，核验 session_id
        S-->>H: TaskState / risk_profile / checkpoint
        opt 新任务
            H->>AU: session.created
        end
        Note over H,M: 主链路不自动读 Memory；GET /api/memory 为独立会话读取
        alt 缺必要风险偏好
            H->>AU: clarification.required
            H->>S: WAITING_INPUT / missing_fields
        else 偏好齐全
            loop VALIDATE_INPUT / DIAGNOSE / GENERATE_CANDIDATES / SIMULATE
                alt 已完成且输入未变
                    H->>AU: stage.reused（故障恢复时）
                else 需要运行
                    H->>AU: stage.started
                    H->>Q: 调用现有工具
                    alt 成功
                        Q-->>H: ToolResult / output
                        H->>S: checkpoint + result_refs
                        H->>AU: stage.completed
                    else 首次失败
                        H->>AU: stage.failed / stage.retry_scheduled
                        H->>Q: 同阶段重试一次
                        alt 重试成功
                            Q-->>H: ToolResult
                            H->>S: checkpoint + result_refs
                            H->>AU: stage.completed
                        else 再次失败
                            H->>S: FAILED 或 CIRCUIT_OPEN / error_state
                            H->>AU: task.failed
                            H-->>API: 抛错并终止后续阶段
                            API-->>UI: error envelope（当前缺 task/session/audit 关联）
                        end
                    end
                end
            end
            Note over H,S: 持仓校验 output.valid=false 时 BLOCKED，停止后续阶段
            H->>S: 成功链路到 RISK_CHECK / HANDOFF_REQUIRED
            H->>AU: stage.handoff
        end
        Note over H: 以下装配仅发生在 runHealthCheck 正常返回后
        H->>S: 写 contract_version / request_id，装配可选市场证据
        H->>AU: contract.accepted（当前为后置事件）
        H->>C: buildResponse + assertHealthCheckResponse
        C-->>API: trace / task_state / artifacts / tool_results / audit_evidence / risk_handoff
        API-->>UI: HTTP 200；Handoff 为 PENDING_REVIEW 或 null
        Note over API,R: 没有自动调用 Risk；execution_allowed 固定 false
        UI-->>R: 待接入：版本化接收与证据核对
        R-->>UI: 待接入：审核状态 / 拒绝原因 / 决策关联
    end
~~~

联调注意：

1. Contract 校验发生在编排前，但 contract.accepted 审计事件目前后置；失败时可能没有该事件和请求编号绑定。
2. 缺偏好、无效持仓、工具抛错均停止后续阶段；图中成功交接步骤只适用于 4 阶段成功。
3. 完成任务相同输入直接返回已有产物；FAILED/BLOCKED 的恢复由 Harness.resume 及 checkpoint 复用支持。不要声称已有统一 HTTP resume Contract。
4. 市场上下文在 Quant 之前校验、之后装配；主链路不会自动读取 Memory。读取按 session_id 隔离，写入须现有 consent，清理继续走原接口。
5. POST /api/risk-workbench/handoff 会运行同一主链路并生成 READ_ONLY_HANDOFF_PREVIEW；不导入远程工作台，不自动审批。
6. checkpoint.result_refs 对应实际 tool_results 的 key；追踪、HTTP 与边界验证见 core-agent-verification-2026-10-10.md。

## 2026-10-15 双链路时序补充

本节补充当前链路；上方 2026-10-10 图仅描述健康检查，旧限制以本节和新联调手册为准。

1. 01 UI → Backend：版本化健康请求 / 模型复核请求；非法输入停止并返回错误
2. 02 健康链路：校验市场夹具 → 装载 Session / Context → 绑定 TaskState
3. 03 Harness → Tools / Quant：按 checkpoint 复用或运行四阶段；失败最多重试一次
4. 04 Harness → Audit：阶段与 checkpoint；装配 trace / artifacts / tool_results / Handoff
5. 05 模型链路：创建 request / task / run / audit → 调用模型；默认总尝试 2 次
6. 06 模型重试：总预算 45 秒含退避 / Retry-After；耗尽 MODEL_FAILED 并保存失败证据
7. 07 模型成功 → 提议及 proposal_sha256 → PENDING_RISK → 持久化 → 返回 UI
8. 08 Risk 读取导出包；正式独立接收和认证待 Owner；测试用演示 callback
9. 09 callback：核对 handoff / task / request / run / audit / hash → 决定及回执原子保存
10. 10 完全相同回调 → DUPLICATE 返回当前状态；改判定证据 409；非法输入 422
11. 11 Risk 通过 → 必要审批 → 仅模拟；取消后旧回调不能恢复；真实执行始终关闭
12. 12 UI 查询 task / run / audit；Memory 无自动长期读写；冲突市场上下文仅待复核

图像版与字段归属见 core-agent-integration-guide-2026-10-15.docx；未完成独立 Risk 正式审核闭环。

## 2026-10-17 当前接口修订

当前入口错误使用 core-agent-error.v1；模型创建 session 关联后调用模型，绑定提议与审计，显式签名派发 Risk；503 写失败审计并等待，回调校验后仍只有 PAPER。正式 Risk 审核闭环尚未验收。完整职责、时序、必填字段与图像见 core-agent-integration-guide-2026-10-17.md 及同名 DOCX。本节修正上方历史限制，不改变运行时接口。

## 2026-10-18 严格校验补充

本轮自动化无业务代码变更；启动时 main 无今日业务提交，团队后续协作者工作区变动单独保留。完整 Schema 检查发现 Risk 导出 source_task_id 未在严格 HandoffPackage 声明，两仓库一致复现。正式接收联调应先解决该字段归属与版本兼容；未修改 Schema 或绕过 Risk。现有回调必填 request/task/run/audit/handoff，session 由存储记录关联，不能称为六编号均由回调必填。当前完整架构、时序、字段归属与限制见 core-agent-integration-guide-2026-10-18.md 和同名双图 DOCX；历史记录不删除。

## 2026-10-19 晚间复验

顶层 source_task_id 别名已由当天业务提交移除；冻结 Handoff Schema 完整校验现通过。本次 32/32 追踪断言、258/258 回归和新合成 Golden Path 通过。正式 Risk 可信回写/审批/网关仍待验收。健康及模型双链路、Memory 边界、未决存储停止点与字段所有权见 core-agent-integration-guide-2026-10-19.md 及嵌入双图的同名 DOCX。历史结论保留，不代表当前仍有已修复格式阻塞。

## 2026-10-20 晚间收尾

双链路与停止点维持不变。本次独立 284/284 回归、32/32 Schema/语义追踪；UI 只读投影消费健康结果，缺数据停止，不产生交易授权。个人 main 在本轮期间同步投资总览提交 3a611dd，最终两 main 均已包含该 UI。字段归属、可选 session、进程内 checkpoint 与正式 Risk 待验收限制见 core-agent-integration-guide-2026-10-20.md 与同名 Word，含可读架构及模块时序图。

## 2026-10-22 main 基线复核

两份 main 独立 284/284 回归、32/32 Schema 与语义检查通过。10 月 21 日可信 reviewer/云适配开发提交 9e6bed1 尚未合入任一 main；不将留存云部署证据称作 main 已完成正式审核。更新图像、字段归属与停止点见 core-agent-integration-guide-2026-10-22.md 及同名 DOCX。
