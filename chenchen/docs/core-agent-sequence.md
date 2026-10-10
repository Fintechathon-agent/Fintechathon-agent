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
