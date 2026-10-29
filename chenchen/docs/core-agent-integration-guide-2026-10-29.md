# Core Agent 联调手册 2026-10-29

状态标签：已实现、已验证、待 Owner 确认。

## 架构与职责
见 core-agent-architecture-2026-10-29.png。Core 负责 Contract 校验、Harness 编排和停止点；Backend 负责 HTTP/错误映射；Session/Context/TaskState 由 Harness 管理；Tools 只消费现有 Quant 输出；Memory 是独立 consent 边界；Risk 消费 Handoff 并独立审核；UI 只展示状态和证据。

## 模块调用时序
见 core-agent-sequence-2026-10-29.png。请求进入 → Contract 校验 → Session/Context/TaskState 装载 → Harness 四阶段 → Tools/Quant → artifacts/tool_results → Audit Evidence → Risk Handoff → PENDING_REVIEW 等待 → 错误重试或终止。Risk 未正式接入时不得宣称审核闭环。

## 统一字段归属
| 字段 | 必填/条件 | 生产方 | 消费方 | 不可修改方 |
| --- | --- | --- | --- | --- |
| request_id / task_id / session_id | 主链路必填或续跑条件必填 | Caller/Backend/Harness | 全链路 | UI、Risk |
| contract_version | 必填 | Contract 生产方 | Backend/Core/Risk/UI | 消费方 |
| task_state / checkpoint | 任务路径必填 | Harness | Backend/UI/Risk | UI、Risk |
| artifacts / tool_results | 成功阶段条件必填 | Tools/Harness | Core/Risk/UI | UI |
| risk_handoff | Risk 边界必填 | Core | Risk/Backend | UI |
| audit_evidence | 事件路径必填 | Core/Backend | Risk/审计/UI | UI |
| error envelope | 异常必填 | Core/Backend | Caller/UI | UI |
| execution_allowed | 当前固定 false | Risk/Backend 策略 | UI/执行网关 | 前端 approval |

两个 main 均 check 通过、测试 284/284、git diff --check 通过；没有新公网调用。Quant 未重算，Memory 规则未改，市场冲突只记 REVIEW_REQUIRED。正式 Risk 身份、接收/回写、Backend 跨链路映射、UI 恢复、Memory 可信引用、Quant/Data 版本时效仍待确认。
