# Core Agent 模块调用时序

~~~mermaid
sequenceDiagram
    participant UI as UI / Caller
    participant API as Backend
    participant C as Contract
    participant H as Harness
    participant Q as Tools / Quant
    participant AU as Audit
    participant R as Risk

    UI->>API: POST /api/health-check/run\ncontract_version + request_id
    API->>C: validate Request
    alt Contract 不通过
        C-->>API: INVALID_CONTRACT\nstage + recovery
        API-->>UI: Error Envelope
    else Contract 通过
        API->>H: create/resume Session + Task
        H->>AU: session.created / contract.accepted
        H->>Q: validate portfolio
        Q-->>H: snapshot + ToolResult
        H->>AU: VALIDATE_INPUT completed
        H->>Q: diagnose / candidates / simulation
        Q-->>H: existing Quant outputs
        H->>AU: stage completed + checkpoint
        alt Tool 首次失败
            H->>AU: stage.failed
            H->>H: retry once
        else Tool 重试仍失败
            H->>AU: task.failed
            H-->>API: FAILED / CIRCUIT_OPEN
            API-->>UI: Error or resumable state
        end
        H->>AU: audit_evidence
        H-->>API: artifacts + tool_results + trace
        API->>R: Risk Handoff + evidence IDs
        Note over API,R: execution_allowed=false
        R-->>UI: 独立 Risk 决策或待复核状态
    end
~~~

## 联调检查点

1. Backend 和 Agent 必须使用同一个 investment-agent.v1.schema.json。
2. 每个阶段结果都要能从 task_state.checkpoint.result_refs 找到对应 ToolResult。
3. 异常必须包含 code、stage、retryable 和 recovery。
4. Risk 只消费 risk_handoff.evidence，不读取未声明的内部字段。
5. UI 只展示状态和证据，不能把 approval 直接变成执行请求。
