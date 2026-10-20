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

## 2026-10-15 双链路架构补充

本节补充当前链路；上方 2026-10-10 图仅描述健康检查，旧限制以本节和新联调手册为准。

1. UI / Caller  →  Backend HTTP  →  Contract 校验  →  Core Agent 编排
2. 健康检查 investment-agent.v1：Harness → Session / Context → TaskState / Checkpoint
3. Harness → Tools / 既有 Quant → artifacts / tool_results → Risk Handoff
4. 模型复核 model-review.v1：ReviewWorkflowStore → 模型提议 / 参数指纹 → Risk Handoff
5. 模型任务：request / task / run / audit；未定义 session_id，不等同 Harness Session
6. Audit：健康链路进程内；模型链路本地文件或云端 Durable Object 持久化
7. Memory：独立会话接口；主健康链路不自动读取；调用材料不等于可信记忆
8. Risk 导出包 → 独立 Risk Owner 待认证联调；演示回调 → 必要审批 → 无副作用模拟
9. 停止点：等待 Risk / 审批；取消、失败、冲突均阻断；真实 execution_allowed=false
10. UI 只消费状态与证据；Quant 计算归原工具；Memory consent 和生命周期归 Memory

图像版与字段归属见 core-agent-integration-guide-2026-10-15.docx；未完成独立 Risk 正式审核闭环。

## 2026-10-17 当前接口修订

当前模型 WorkflowRecord 已定义 session_id（Schema 可选），9 条审计事件的六编号关联已核验。健康 Harness 与模型 ReviewWorkflowStore 为两条存储路径；跨链路四响应字段映射待 Backend。正式 Risk 审核闭环尚未验收。完整职责、时序、必填字段与图像见 core-agent-integration-guide-2026-10-17.md 及同名 DOCX。本节修正上方历史限制，不改变运行时接口。

## 2026-10-18 严格校验补充

本轮自动化无业务代码变更；启动时 main 无今日业务提交，团队后续协作者工作区变动单独保留。完整 Schema 检查发现 Risk 导出 source_task_id 未在严格 HandoffPackage 声明，两仓库一致复现。正式接收联调应先解决该字段归属与版本兼容；未修改 Schema 或绕过 Risk。现有回调必填 request/task/run/audit/handoff，session 由存储记录关联，不能称为六编号均由回调必填。当前完整架构、时序、字段归属与限制见 core-agent-integration-guide-2026-10-18.md 和同名双图 DOCX；历史记录不删除。

## 2026-10-19 晚间复验

顶层 source_task_id 别名已由当天业务提交移除；冻结 Handoff Schema 完整校验现通过。本次 32/32 追踪断言、258/258 回归和新合成 Golden Path 通过。正式 Risk 可信回写/审批/网关仍待验收。健康及模型双链路、Memory 边界、未决存储停止点与字段所有权见 core-agent-integration-guide-2026-10-19.md 及嵌入双图的同名 DOCX。历史结论保留，不代表当前仍有已修复格式阻塞。

## 2026-10-20 晚间收尾

双链路与停止点维持不变。本次独立 284/284 回归、32/32 Schema/语义追踪；UI 只读投影消费健康结果，缺数据停止，不产生交易授权。团队投资总览 UI 提交尚未进入个人 main。字段归属、可选 session、进程内 checkpoint 与正式 Risk 待验收限制见 core-agent-integration-guide-2026-10-20.md 与同名 Word，含可读架构及模块时序图。
