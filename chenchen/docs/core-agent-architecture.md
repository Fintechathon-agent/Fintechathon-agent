# Core Agent 主链路架构

## 北极星和边界

Core Agent 负责把用户请求变成可追踪的任务、调用已有工具、整理证据并把结果交给 Risk。它不重新计算 Quant，不修改 Memory 规则，也不绕过 Risk。

~~~mermaid
flowchart LR
    UI[UI / 调用方] --> API[Backend API]
    API --> V[Contract Validator\ninvestment-agent.v1]
    V -->|不通过| E[Error Envelope\ncode / stage / recovery]
    V --> H[Harness]
    H --> S[Session + Context]
    H --> T[Task State\n状态 / checkpoint / resume]
    H --> Q[现有 Tools / Quant\n只调用，不复制计算]
    H -.只按既有规则.-> M[Memory\n规则由 Memory Owner 维护]
    Q --> A[Artifacts + Tool Results]
    S --> A
    T --> A
    H --> AU[Audit Evidence\n事件 / 时间 / trace]
    A --> RH[Risk Handoff\n证据引用]
    AU --> RH
    RH --> R[Risk / Safety / Eval]
    R --> UI
    E --> UI
    H --> X{异常或重试}
    X -->|首次失败| H
    X -->|重试仍失败| E
~~~

## 模块职责

| 模块 | Core Agent 的调用方式 | 不负责什么 |
| --- | --- | --- |
| UI | 发送版本化 Request，展示状态、证据和 Risk 结果 | 不把前端 approval 当作交易授权 |
| Backend | 校验 Request，返回统一 Response / Error | 不隐藏 task、session 或 audit 关联 |
| Harness | 编排 Session、Context、Task State、checkpoint、重试 | 不拥有 Quant 公式 |
| Tools / Quant | 返回已有健康报告、候选和模拟结果 | 不因市场简报被 Core Agent 重算 |
| Memory | 按既有 consent、范围和生命周期提供能力 | Core Agent 不修改 Memory 规则 |
| Risk | 消费 Handoff 证据并做独立判断 | Core Agent 不替 Risk 决策 |
| Audit | 保存每个阶段事件和引用 | 不把事件解释成收益承诺 |

## 一次请求的统一关联键

contract_version 固定接口版本；request_id 标记一次请求；task_id 标记可恢复任务；session_id 标记会话；trace 连接响应；audit_evidence.audit_id 连接审计链；risk_handoff.evidence 指向实际产物。

## 风险停止点

主链路到达 HANDOFF_REQUIRED 后停止，固定返回 execution_allowed: false。Risk 尚未接入或返回决策前，Core Agent 不生成执行授权。
