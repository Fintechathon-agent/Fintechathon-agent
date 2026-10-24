# 六模块统一工作空间 Contract 提案

状态：待用户确认，并由Core、Risk、Approval、Audit对应Owner记录确认后再合入。当前不修改共享后端、数据库或正式权限逻辑；不更新team-release。

2026-10-24 后续确认：用户已明确批准隔离 team-staging 的 UI/业务集成候选、只读上下文分析与本地草案/事件存储。这不代表正式 Core/Risk API、数据库 Schema 或策略已获 Owner 批准。实际候选使用本机 `/api/assistant/workspace/state|analysis|task`，复用现有 HttpOnly Cookie 路径；仅监听127.0.0.1，任务保持 WAITING_OWNER_RISK，拒绝所有资金执行与正式风险写入。下述正式集成提案继续待对应 Owner 确认。

## 需要确认的最小服务变更

现有生活服务 `/api/assistant/message` 同时解析记账和分析，直接拼接持仓/预算JSON可能生成不应出现的账本条目。需独立只读分析动作，不能由前端假定它已经存在。

建议由Owner新增或指定等价的只读分析接口（候选 `POST /api/workspace/analysis`），复用 `model-review.v1` 字段：request_id、session_id、context、portfolio_snapshot_id、plan_id、data_mode、idempotency_key、memory_consent=false、allow_rule_fallback=false、execution_mode=PAPER、capability=REVIEW_ONLY。服务端校验来源归属、版本、授权范围及长度，并引用服务端快照，不能信任浏览器自称的角色或所有者。

该候选路径只是提案，尚未实现。优先由Owner提供现有等价API；如能复用 `/api/review` 则保持原路径，但需确认本地代理与鉴权、预算策略。

## ID与状态映射

| 对象 | 复用/要求 |
| --- | --- |
| 用户/角色 | 使用服务端会话标识和已认证角色；匿名本地会话不是正式账户 |
| 投资快照 | 复用portfolio_snapshot_id/as_of；保留FIXTURE与用户自述区别 |
| 预算/目标 | 由生活Owner确定版本/归属；未提供金额保持null，不自动从收入推断 |
| 分析 | 复用request_id/run_id/session_id；冻结输入摘要哈希与来源引用 |
| 风险 | 复用risk-handoff.v1与Owner签名；ALLOW/REVIEW/BLOCK由正式风险服务返回 |
| 草案/任务 | 优先沿用既有task_id/plan_id/plan_hash/source_task_id；浏览器草案用单独demo前缀，不伪装成正式task |
| 审计 | 复用audit_id和既有事件结构；关联session_id/run_id/task_id与来源引用，避免重复存完整敏感正文 |

## 建议流程

读取已授权组合/预算 → 用户检查并确认发送范围 → 只读模型分析（真实连接状态与供应商证据）→ 正式风险交接 → 验证Owner回执 → 用户确认完整草案 → 写入待办任务 → 只读查询任务与审计。

- ALLOW：仅允许进入建议确认或草案创建，不允许直接资金执行。
- REVIEW：暂停动作，等待用户本人或按后端策略所需的授权角色确认；普通用户不能代签Owner风险回调。
- BLOCK：禁止进入后续敏感操作，保留最小拒绝原因与关联ID。
- 未连接/未知/超时：保持待审查，绝不映射成ALLOW。模型自己写的ALLOW也不是可信Risk决定。

## 前端可以独立完成的范围

统一Shell、六入口、旧链接兼容、草稿与页面状态保存、现有API读取、来源展示、选定上下文预览。显式DEMO可以使用浏览器内部状态演示，但不提供真实角色授权、签名审计或交易执行，不宣称正式链路已完成。

## 待确认

1. 是否批准在隔离的team-staging候选中实现上述只读上下文分析适配器（不改Core/Risk正式接口、不正式部署）？或提供既有等价服务及Owner。
2. 组合、预算、身份、任务、审计分别使用哪个已确认服务？需固定Origin与签名/鉴权方式。
3. 任务草案的服务端持久化、去重窗口、风险回执版本，以及用户确认事件的Owner字段映射。

未经确认不新增上述后端路径、公共字段、数据库表或风险策略；前端完成后分别报告已联通、仅DEMO和待Owner的状态。
