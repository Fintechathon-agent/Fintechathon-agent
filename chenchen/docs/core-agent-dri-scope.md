# Core Agent 主链路 DRI 范围

## 目标

Core Agent 负责把 Personal AI Fund Manager 的主链路串起来，让 Agent、Backend、Risk、Memory、Quant 和 UI 在接口、状态和责任边界上保持一致。

主链路目标是：

```text
用户请求 → Session / Context → Core Agent Harness → Tools / Quant 结果
        → 统一 Contract → Risk 复核边界 → UI 展示
```

Core Agent 的完成标准不是自己拥有所有能力，而是能够可靠地调用各模块、保留可追踪状态、传递统一结果，并在责任边界处停下等待下一方处理。

## Core Agent 负责什么

- 维护任务生命周期：创建、运行、等待补充信息、恢复、失败和交接。
- 维护 Session、Context、TaskState、Checkpoint 和运行记录之间的关联。
- 通过统一 Contract 传递输入、输出、错误、证据和追踪编号。
- 调用 Tools / Quant 已提供的结果，并把结果组织成可审计的 Agent 输出。
- 在到达 Risk 边界时生成 Risk Handoff，保证证据完整且不产生执行授权。
- 发现输入缺失、工具失败、状态不一致或 Contract 不匹配时停止并明确报告。
- 每天收尾前同步主链路进展、接口风险、阻塞项和次日计划。

## 明确不负责什么

### 不重新计算 Quant

Core Agent 不复制或改写收益、风险、相关性、回测、模拟等 Quant 计算逻辑。需要新的计算能力时，先与 Quant 约定输入、输出、版本、数据日期和错误格式，再通过接口调用。

### 不修改 Memory 规则

Core Agent 不自行改变记忆的 consent、范围、生命周期、清理和持久化规则。只使用 Memory 提供的接口，并原样传递必要的会话标识和用户授权状态。

### 不绕过 Risk

Core Agent 不把 Agent 的建议当成批准，不接受前端 approval 作为真实授权，不直接执行交易。所有需要 Risk 判断的结果必须通过 Risk Handoff 交接，`execution_allowed` 默认且固定为 `false`，直到正式安全网关和审批链路接入。

### 不替 UI 决定产品表达

Core Agent 提供稳定、清晰、可解释的状态和结果。页面如何排序、折叠、命名和展示，由 UI 根据共同 Contract 负责；Core Agent 不为适配单个页面而改变底层语义。

## 每日检查清单

每天 22:00 的 Daily Update 至少检查以下内容：

- 主链路当前停在哪个阶段。
- 当天新增或完成的 Core Agent 工作。
- Agent / Backend / Risk 的 Contract 是否仍然一致。
- Session、TaskState、Checkpoint 和 request_id 是否能够关联追踪。
- 是否调用了 Quant 已有结果，是否出现重复计算或口径漂移风险。
- 是否触碰 Memory 规则，是否出现绕过 consent 或生命周期的风险。
- 是否到达 Risk 边界并正确生成 Handoff。
- UI 当前依赖的字段是否仍然存在、含义是否改变。
- 当天测试、Smoke Test 或联调结果。
- 阻塞项、责任方、下一步动作和预计影响。

## 更新规则

- Daily Update 只记录事实、验证结果、风险和待办，不用模糊的“基本完成”代替证据。
- 没有真实进展时明确写“今日无代码变更”，不要为了产生日报而改代码。
- 任何接口字段变化都要同时记录版本、影响方和兼容策略。
- 每次更新保留历史记录，不删除之前的日期。
- Daily Update 生成后同步到团队仓库和个人仓库的 `chenchen/docs/` 目录。

