# P0/P1 UI 任务查询、审批与资金来源接入缺口

状态：待对应 Owner 书面确认。日期：2026-10-27，北京时间。关联候选：`team-staging/ui/p0p1-task-safety-20261027/`。

这是接入缺口登记，不是新的正式 Contract。本轮没有新增后端路由、公共字段、权限、Schema、审批或资金逻辑；前端只消费既有查询，正式接入在边界停止。

## 已按现行 Contract 落地的 UI

- investment-agent.v1：原 `/api/health-check/run`、`/api/task/{task_id}`、`/api/audit/{task_id}`；保留原请求、任务、会话及实际存在的审计/交接编号，不把固定演示诊断当真实模型。
- review-workflow.v1：只读 `/api/review/task/{task_id}`；分别显示任务九态、业务风险、Owner身份元数据、审批、计划摘要、实际PAPER回执及真实事件。不提供Risk写回、审批或执行按钮。
- risk-callback.v1：仅按已冻结词汇显示 APPROVE→ALLOW、REQUEST_MORE_INFO→REVIEW、REJECT→BLOCK；不新增回调字段，不把网络/身份错误伪装成Risk引擎BLOCK。
- 原 `/api/assistant/workspace/*` 始终标为隔离候选，绝不替代以上正式接口；localStorage仅用于草稿，不生成正式风险、身份或审计。

## 需要确认的最小接线

| 缺口 | 当前证据与停止位置 | Owner 需要给出的决定 |
| --- | --- | --- |
| 同源代理与身份 | 公网Core/Risk业务查询401；浏览器不能携带机器凭据 | 林粹/主聊天/架构Owner指定代理、已认证用户会话和正式部署SHA；优先复用既有接口，不猜测URI |
| 正式任务恢复 | 健康检查/复核按已知task_id查询；没有正式列表和request_id恢复能力可确认 | Core/Audit Owner确认查询持久性、未知请求的恢复流程和会话范围；没有能力时保留原关联号安全停止 |
| 千问到Core计划 | 本机千问候选与Core各有明确协议，没有正式分析到计划的映射 | Core/模型Owner明确源分析与source_task_id/plan_hash的实际绑定方式、受限qwen3.8-flash验收预算；不能由UI编造ID |
| Risk决定可信性 | 现行auth.verified可区分服务签名和演示决定；不能证明最终用户身份 | Vesper/Core Owner固定规则/签名部署与计划摘要；按既有允许字段回调，新增语义另评审 |
| 用户审批 | 页面只读后端状态/有效期，不代替身份和完整计划验证 | 李想/审批Owner/林粹确认可信本人审批、版本、期限及重放保护；不把资料核对待办当资金审批 |
| Finance账本 | qiqi金额为元，本机生活候选预算为整数分；没有共享可信账户版本 | Finance Owner指定唯一账本、归属、版本、单位和原子预留/提交/释放责任；未知值保留未知，不新增假余额 |
| 唯一PAPER执行方 | 多个局部模拟入口并存，真实云端同账本闭环未验收 | 架构/Finance/Core/Risk Owner确定唯一受控网关；未确认前所有UI执行入口关闭 |

Vesper `codex/risk-p0-review-pack-20261026@8933fe3` 中的subject/account/nonce等统一上下文仍为提案，本轮不塞进冻结Schema，也不移除必要字段绕过校验。

## 验收需要的真实证据

同一个用户/账户/任务/计划摘要：授权数据 → 真实qwen3.8-flash响应 → Core计划 → 正式Risk → 后端本人批准 → 唯一PAPER网关 → 实际回执 → 真实审计。补恶意指令、越权、超额、过期、版本冲突、丢回执、并发重复与服务异常。

本轮已有36项UI/契约专项、七宽度浏览器、真实Core确定性诊断和测试替身工作流验证；这些都不替代上述公网验收。没有新的模型费用授权，不发送付费请求。

请在团队认可的讨论渠道记录Owner确认，再评审合并；本轮不发群消息、不合并main、不更新team-release、不部署或更新公开预览。
