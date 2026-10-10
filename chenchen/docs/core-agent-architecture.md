# Core Agent 主链路架构

更新：2026-10-10 22:00 北京时间。以下实线表示当前实现，虚线表示独立接口或待 Owner 接入；不是完整 Risk 服务端到端成功证明。

~~~mermaid
flowchart LR
    UI["UI / Caller"] --> API["Backend API"]
    API --> V["Contract Validator: investment-agent.v1"]
    V -->|非法输入| E["Error Envelope / HTTP 422"]
    V --> C["Core Agent: runHealthCheckContract"]
    C --> H["Harness: create / reuse Task"]
    H --> S["Session: session_id"]
    H --> CTX["Context: risk_profile / portfolio"]
    H --> TS["TaskState / Checkpoint: task_id"]
    H --> Q["Tools / 现有 Quant"]
    Q --> A["Artifacts / ToolResults"]
    H --> AU["Audit Evidence: 进程内事件"]
    C --> MC["市场夹具校验 / REVIEW_REQUIRED"]
    MC --> A
    A --> RSP["统一 Response / trace"]
    TS --> RSP
    AU --> RSP
    RSP --> RH["Risk Handoff: PENDING_REVIEW"]
    RH --> STOP["停止: HANDOFF_REQUIRED / execution_allowed=false"]
    RSP --> API
    API --> UI
    API --> B["只读 Risk Workbench Adapter"]
    B --> UI
    UI -.人工对照 / 待版本化接收接口.-> R["独立 Risk Owner / 审核回写待接入"]
    API -.独立 save / list / clear 路由.-> M["Memory: session-only / consent"]
    E --> UI
~~~

| 模块 | 当前职责与数据 | 边界 / 停止点 |
| --- | --- | --- |
| Core Agent | 校验版本化请求，装配市场证据、trace、响应与 Handoff | 不复制 Quant 公式，不产生批准或执行授权 |
| Backend | HTTP 路由、请求错误映射、审计读取、只读适配 | 只读包 HTTP 200 不表示 Risk 接收成功 |
| Harness | 4 阶段编排、最多 2 次尝试、结果复用、输入变化失效 | 缺偏好 WAITING_INPUT；无效持仓 BLOCKED；失败 FAILED / CIRCUIT_OPEN |
| Session | Harness 创建 session_id，续跑核验与 task 的绑定 | 会话不匹配停止；当前进程内存，不保证跨进程恢复 |
| Context | RequestContext 的 actor/environment/data_mode 和 task/session；input 持仓及偏好 | 当前 demo / SYNTHETIC_REPLAY；不是长期 Memory 自动装载 |
| TaskState | stage/status、checkpoint.completed/result_refs/resume_token | 所有权归 Harness；Risk/UI 不能改成批准 |
| Tools / Quant | validatePortfolio、diagnosePortfolio、generateCandidates、runSimulation 现有结果 | 健康指标、候选 target_weights、模拟 comparisons 原样消费 |
| Memory | 独立 session save/list/clear；保存须 consent=true | 主健康检查未自动读取；授权、范围、生命周期、清理由既有模块负责 |
| Risk | 消费 Handoff 证据，独立复核 | 当前只有 PENDING_REVIEW 交接包；正式 Consumer/决策回写未接入 |
| UI | 展示 task_state、trace、证据、错误恢复提示；人工打开工作台 | approval 不是交易授权；Pages 是固定 JSON 展示 |
| Audit | audit_id、task/session/request/version、阶段事件 | 进程内事件，不是长期 Memory 或持久化审计存储 |

当前完整响应的 trace 与 TaskState、AuditEvidence 可对齐；Handoff 自身没有 request_id，须连同响应 trace/audit 或 bridge.source 交接。续跑后审计信封 request_id 为最新请求，历史 contract.accepted payload 保留旧编号。失败信封尚不含 task_id/session_id/audit_id。证据与复现见 core-agent-verification-2026-10-10.md；字段必填与归属见 ../contracts/README.md。
