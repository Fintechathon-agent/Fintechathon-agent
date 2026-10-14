# P0 UI 接口差异与 P1 联调建议

日期：2026-10-14。提案待对应 Owner 确认，不修改 Shared Schema、授权或执行规则。

## 基线与新增事实

P0 基于团队 main `8b3922edf314bc8e3ab95602fe86b2a20ac5bd0d`。收尾 fetch 发现 main 更新至 `55b8978cd267064d5a972059a925b624e69d95fd`。新提交尚未合并到 P0，也未使用旧测试结果为新 main 背书。

最新 main 已新增 `chenchen/integrations/legacy-review-adapter.js` 和 `/api/review/legacy`：将 question 转为 kind/text/requested_action，返回 legacy-review.v0。原 `/api/review` 仍是 model-review 工作流。适配器明确 `auto_executed:false`、`execution_allowed:false`，不能视为 PAPER 交易接通。

## 逐项交接

|接口/概念|已验证现状|P0 处理|P1 需要确认|
|---|---|---|---|
|Node health check|investment-agent.v1；task_state、artifacts、trace、audit_evidence；HANDOFF_REQUIRED|真实本地服务诊断，数据标记 DEMO / FIXTURE|林粹/Core：与正式模型工作流的身份、任务生命周期关系|
|Python 与 Node review|question 与 kind/text/action 不同；最新 main 有专用 legacy 适配端点|自然语言只保存用户目标草稿，不调用不兼容接口|金怡含、林粹：选择正式端点、单位、错误结构、认证方式与部署来源|
|Risk 交接|独立分支导入可能生成 Risk 本地 task_id，需 source_task_id 等关联|展示只读交接，不能把它当正式决策；没有审批/执行按钮|Vesper：决策来源、原因、源任务关联和统一 Risk 状态；REVIEW 不等于权限黄色级别|
|审批|现有流程与方案摘要、本人确认相关|待接入；不将批准视为成交|Core/Gateway Owner：方案绑定、幂等键、审批权限与失效条件|
|执行|无副作用模拟回执不改变 PAPER 账本|不提交交易、不更新余额；UNKNOWN 引导核查原任务|金怡含、Gateway Owner：明确模拟回执与纸交易账本查询的契约及对账接口|
|审计与任务恢复|本地 Core 任务与事件可按同一 task_id 查询|只读恢复；审计失败清除旧事件并允许重新读取|Memory/Audit Owner：跨会话授权、持久化与隔离；不能以本地内存证明已持久化|

## 最小联调顺序

1. Owner 评审最新 main 的 legacy adapter 与正式入口选择，冻结请求、错误、来源和任务关联样例。
2. 在独立分支复核最新 main 增量，保留新的服务端 guard；本轮只读检查发现 server.js 同文件有变化，但修改位置分别为 API 与静态资产，不据此宣称已合并或无冲突。
3. 一个 Portfolio 任务贯穿诊断、方案、只读 Risk、详情和审计。跨服务保留源任务关联，不擅自覆盖 Risk 本地编号。
4. Owner 接通确认与 PAPER 执行后，再加入受服务端权限约束的操作；先验收 BLOCKED、ERROR、UNKNOWN、重复提交与失效审批。
5. 用真实回执及账本查询验收，最后经用户确认推送 UI 工作分支。禁止直接推送 main 或自动合并。
