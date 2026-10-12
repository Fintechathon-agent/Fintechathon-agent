# 金融平台第一阶段：角色权限与案件复核 Contract 提案

状态：待用户及对应 Owner 确认；本文不是已生效接口，不得据此自行修改后端或伪造服务端响应。

本次前端开发补充：团队主仓库已由用户正式确认是 Fintechathon-agent/Fintechathon-agent。功能分支 feature/xinlan-role-workspaces 从最新 main 的 cac927922c2b061c72000c05648e4facb3c0fd17 创建；下方 2389319 是提案形成时的旧 UI 基线，非本次开发基线。用户已授权独立的前端模拟展示与测试，未授权后端 Contract 实施。页面内固定样例不是服务端输出，角色预览不构成 RBAC；原提交 176ffba 完整保留在原分支。

## 1. 变更原因与确认范围

用户希望采用 One Platform, Two Workspaces, Role-Based Access Control，统一登录与品牌，提供 Personal Hub 和 Risk Console。当前首版“审批”是用户本人确认完整计划，内部风控人员复核属于新增流程，不能复用 `/api/safety/confirm` 冒充内部审批。

请邹昕成确认平台架构、身份来源、API 与 Golden Path 扩展；潘心恬确认角色权限、案件复核、规则发布及审计要求；陈金宝确认会话与任务绑定。用户确认后，仍需按 AGENTS.md 在群或飞书 Wiki 留记录，由对应 Owner 确认后合并。记录地址与确认版本目前未提供。

## 2. 仓库事实

- 当前 UI 基线：`23893196a3f73b41fdcdca3005d8baa45c40071c`，原生 HTML/CSS/JavaScript、Node HTTP 服务、Node test runner、Playwright。
- 已读取远程 main：`cac927922c2b061c72000c05648e4facb3c0fd17`；团队风控分支：`994467323a523fe069ffc9902ace109ad6bfb6b7`。只读检查，不代表已合入当前分支或已验证线上部署。
- 本地 `chenchen/server.js` 提供持仓、诊断、方案、模拟、任务与审计路由，模拟执行入口返回 `503 GATEWAY_NOT_CONNECTED`。
- 团队 Worker 提供服务端访客会话、CSRF、任务归属检查、用户计划确认、模拟执行及云存储。其 `/api/safety/session` 返回 `csrf/user_id/mode`，不是四角色登录协议。
- 已检查的本地与远程相关代码未发现四角色案件权限、案件分派及内部人工审核完整接口；访客隔离不能替代员工认证和 RBAC。
- 当前诊断返回集中度、现金比例、相关性、历史窗口等，没有可验证的 Financial Health Score 模型。第一阶段不显示健康分数。

## 3. 建议权限矩阵（待确认）

| 操作 | 普通用户 | 风控分析员 | 风控主管 | 系统管理员 |
|---|---|---|---|---|
| Personal Hub | 仅本人 | 需另授普通用户身份 | 需另授普通用户身份 | 需另授普通用户身份 |
| 用户风险事件与历史 | 仅本人、可披露字段 | 仅获分派案件范围 | 本组织授权范围 | 默认无金融详情权限 |
| Case Queue / Case Review | 禁止 | 查看分派案件、补充意见、提交复核 | 分派、复核结论、退回 | 禁止 |
| 用户完整计划确认 | 仅本人 | 不可代理 | 不可代理 | 不可代理 |
| Policy Management | 禁止 | 只读有效策略 | 按单独授权发起策略变更 | 仅技术配置，不授予业务发布权 |
| Audit Logs | 本人可披露记录 | 案件范围 | 业务授权范围 | 技术审计范围，敏感业务字段脱敏 |
| 身份与权限管理 | 禁止 | 禁止 | 禁止 | 可管理身份；禁止自授金融审批权 |

服务端默认拒绝未知角色和未授予的能力；每个读写接口独立检查身份、能力、组织与对象归属。不得信任 URL、localStorage、请求体内 role/user_id 或前端隐藏按钮。多角色账号仅可切换服务端授予的工作台，业务审批能力不能从管理员身份隐式继承。管理员权限变更需独立授权与审计，不得通过创建或修改账号绕过业务权限边界。

## 4. 状态必须分离

| 维度 | 表达 | 约束 |
|---|---|---|
| 风控决策 | 复用 ALLOW / REVIEW / BLOCK；ERROR 保留为检查失败 | 由风控规则输出，前端不推导 |
| 人工复核状态 | 建议独立 NOT_REQUIRED / PENDING / IN_REVIEW / RESOLVED，最终命名由 Owner 确认 | 结案不等于 ALLOW，也不等于成交 |
| 用户计划确认 | 复用现有用户确认状态与版本绑定 | 内部审核不可替用户确认 |
| 执行状态 | 复用模拟执行状态及真实模拟回执 | 无回执显示模拟待确认/结果未知 |

人工复核记录结论与依据，可要求补充资料或触发规则重评；不得直接把 BLOCK 改成 ALLOW。重评生成新的决策版本，保留原判定。策略发生变化或计划变化后，既有用户确认按 Owner 规则失效。ERROR 不得映射为“风险检查通过”。

## 5. 新接口需求（建议形状，非已存在路由）

优先扩展团队服务而非另建金融后端。路径、Schema 与身份供应方由 Owner 定稿。

| 建议接口 | 用途与服务端约束 |
|---|---|
| GET /api/identity/me | 返回可信 subject、roles、capabilities、allowed_workspaces、默认工作台；未登录 401，权限不足 403 |
| POST /api/identity/logout | 撤销会话；写请求校验 CSRF；Cookie 使用 HttpOnly、Secure、SameSite |
| GET /api/personal/risk-events | 本人事件摘要、通知已读状态、可披露原因、下一步操作、数据模式、分页 |
| GET /api/personal/risk-events/:id | 本人事件详情、公开证据摘要和处理指引，不包含内部阈值或其他用户信息 |
| POST /api/personal/risk-events/:id/acknowledge | 仅标记通知已读，不等于业务审批或解除拦截 |
| GET /api/risk/cases | 按授权范围分页列出队列；筛选由服务端执行 |
| GET /api/risk/cases/:id | 独立返回风险决策、复核流程、用户确认、执行状态与各版本 |
| POST /api/risk/cases/:id/assign | 主管按授权范围分派；记录操作者与前后状态 |
| POST /api/risk/cases/:id/reviews | 复核意见、结论、证据、expected_version、idempotency_key；服务端校验能力和当前状态 |
| GET /api/risk/policies | 读取有效策略与版本；首阶段 Policy Management 可只读，策略写接口另行确认 |
| GET /api/risk/audit | 服务端授权、分页、脱敏；不能信任客户端过滤 |

示例字段仅用于协议讨论，不生成前端业务记录：

```json
{
  "case_id": "example-case-id",
  "event_id": "example-event-id",
  "task_id": "example-task-id",
  "version": 1,
  "data_mode": "SIMULATED",
  "risk": { "decision": "REVIEW", "decision_id": "example-decision-id" },
  "human_review": { "status": "PENDING", "assignee_id": null },
  "public_reason_codes": [],
  "next_actions": [],
  "updated_at": "2026-10-11T00:00:00Z"
}
```

个人端与内部端使用不同响应投影，不能先发送内部字段再在浏览器隐藏。Financial Health Score 当前缺失；Transaction Risk Level 如果尚无正式枚举与计算规则，也不得由 ALLOW/REVIEW/BLOCK 自行换算成低中高。

## 6. 闭环与一致性

1. 经授权的演示入口创建明确标注 SIMULATED 的事件，服务端绑定主体、任务、事件与请求 ID。
2. 调用现有风控引擎保存判定及证据；需要复核时创建案件，通知内容由服务端形成可披露投影。
3. 普通用户查看本人通知及指引；分析员在授权案件内提交意见；主管按权限完成复核。
4. 必要时重新评估；更新案件版本、用户可见状态及审计记录。页面重新请求服务端状态，轮询间隔由部署方确定，不以本地状态变化作为同步成功。
5. 审核过程不替代用户确认；仅在既有网关允许、确认有效、审计已持久化后进行模拟执行。

状态变化与审计写入须原子提交，或使用 Owner 明确确认的可靠事件投递方案。审计写入失败不得返回操作成功；重复请求不能重复提交结论；过期版本返回 409 并要求刷新。两端保留最后更新时间，断网显示旧数据与重试入口。本文不扩展真实资金或银行拦截能力。

## 7. 验收清单

- 未登录访问内部 API 被拒；普通用户直接调用内部接口被拒。
- 普通用户不能读取别人的事件、详情、导出或审计；分析员不能读取未获授权案件。
- 管理员不能完成业务复核、代理用户确认或自授审批权。
- 篡改 role、主体 ID、工作台 URL 不扩大权限；退出或撤权后旧会话不能继续写入。
- 缺失/错误 CSRF 被拒；并发复核的旧版本被拒；幂等请求仅产生一次业务状态变化。
- REVIEW 与人工复核 PENDING 分开展示；RESOLVED 不自动放行 BLOCK；ERROR 不默认通过。
- 模拟事件、服务端判定、通知、内部复核、状态同步、审计可用相同关联 ID 追踪。
- 审计失败、接口 503、断网、空队列均有明确状态，无假分数、假成功或银行成交声称。
- 个人端只呈现“风险检查通过 / 需要进一步核实 / 操作已拦截”；后台保留专业值。
- 375/768/1440 宽度、键盘操作、焦点、表格溢出与可读性验证。

## 8. 执行门槛

请确认是否批准上述架构方向，并提供对应 Owner 的 Contract 确认记录及接入分支。确认前不新增后端接口、不实现假身份路由、不将现有用户确认按钮改成员工审核按钮。确认后按最小改动计划接入，并对真实服务端权限与闭环执行测试。
