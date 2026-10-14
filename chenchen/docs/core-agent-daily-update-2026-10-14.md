# Core Agent Daily Update · 2026-10-14

本版为当日下午迭代记录，可供 22:00 收尾继续补充。范围：Core Agent 主链路；不重算 Quant，不修改 Memory 规则，真实执行仍阻断。

## 1. 已完成的核心接口

- 新增 `risk-handoff.v1` 独立交接包与 `risk-callback.v1` 回调，原 `/api/review` 和旧决策入口保留。
- 可按任务或运行编号读取交接材料；回调必须绑定同一 handoff/task/request/run/audit 和 proposal hash。
- 相同回调可安全重试；编号不符、夹带金额、变更决定或审核人会拒绝并留审计记录。
- 保存当次原始输入供 Risk 独立检查，标记为未经验证的调用方材料；不作为可信记忆或执行授权。
- 工作台默认换为“投资8000元是否影响交房租”，补充可见金额输入，Risk 操作改走新回调，交接详情默认折叠。
- 修正“要求补充信息”后仍显示可重新批准按钮的问题；补充后需新建任务复核。

## 2. 可验证的集成进度

| 层级 | 当前事实 | 证据 |
| --- | --- | --- |
| 演示覆盖 | Risk / 审批由人工按钮或脚本扮演；批准、拒绝、补材料、重试和异常已覆盖 | 自动测试 83 项通过，含云端专项 9 项 |
| 真实接通 | 工作台调用公网 Backend，Backend 调用真实 Workers AI，Durable Object 保存审计 | 部署 `756201ce-d043-4c0c-8f22-43bdf7c4e681`；15:20–15:21 公网 34 次检查通过 |
| 联合验收 | 独立 Risk 服务、正式审批身份与真实执行网关尚未联合验收 | 不得将演示按钮或 HTTP 200 描述为外部系统批准 |

三条可查任务：

- APPROVE→审批→模拟：`review-task-e1b5e14b-6033-4c53-85d3-19ca174a3cfa`。
- REJECT→阻断：`review-task-8d9437ba-72b6-4635-88fe-fe1f7be40325`。
- REQUEST_MORE_INFO→继续等待：`review-task-a574effe-4f2c-4e0f-9789-9bf56707fdfe`。

查询地址：`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/review/task/{task_id}`。所有任务 `execution_allowed=false`，模拟回执 `side_effects=false`。终端验收使用现有本机代理。

文档与原始证据：

- [联调手册、架构图与时序图](risk-handoff-integration-2026-10-14.md)
- [公网响应与完整最终记录](public-risk-handoff-callback-2026-10-14.json)
- [记事本测试记录](../logs/Core-Agent-公网测试记录-2026-10-14.txt)
- [逐请求运行日志](../logs/core-agent-e2e-public-2026-10-14.jsonl)

## 3. 需要 Owner 配合的阻塞项

1. Risk Owner：确认接收 Contract、独立规则服务地址与认证方式，完成真实服务回调。当前 reviewer 字符串只是演示标签。
2. Memory Owner：给出“用户确认的资金用途”的可信引用、版本、有效期与撤回协议；不能将用户或外部文本直接升级为可信约束。
3. Approval / Backend Owner：补正式审批人身份、权限、访问隔离；演示公开接口不适合真实财务资料。
4. Execution / Risk Owner：给出跨任务资金占用与执行前再检查协议；真实网关未接入，继续阻断。

本轮业务发现：同一房租冲突模型可能给出 low 或 high，本轮最新三条均为 low。只把模型当提议是必要边界；尚不能承诺资金用途硬约束、多个任务叠加保护已实现。后续优先与 Risk/Memory Owner 完成这些合同与规则验收，而非扩其他场景。

## 版本保留与团队范围

本轮所有修改限定 `chenchen/`，新增部署入口 `chenchen/wrangler.toml`，根目录旧部署文件及旧日报保留。团队仓库已先吸收其他成员的 5 次 `qiqi/` 提交，不修改其文件。个人、团队仓库分别保留历史提交；本轮交付需以两个远程仓库的实际提交为准。

## 网页与同步收尾核验

- 个人仓库主分支功能提交 `793f993`，团队功能提交 `888fa45`，团队合并提交 `6bdec05`；其他成员同期新增的两份 `qiqi/docs/` 文件已合并保留。
- GitHub Pages [部署记录](https://github.com/realchenchenluo/agent/actions/runs/38528489267) 成功，当前公网后端版本仍为 `756201ce-d043-4c0c-8f22-43bdf7c4e681`。
- 从已部署工作台实际点击发起任务：`review-task-fc64e6e2-680c-48ab-ae7a-8144ca79e4b3`；真实模型返回，点击“要求补充信息”后进入 `PENDING_RISK`，执行仍为 `BLOCKED`，继续 Risk 操作按钮消失。
- 交接详情与完整响应默认折叠；390 像素手机视口下页面内容宽 375，无横向溢出；检查后恢复正常视口。这是手机宽度模拟检查，不代表真实手机设备测试。
- 公网三个最终记录生成的交接包、回调请求、回调响应共 9 份通过 JSON Schema 校验；请求示例也通过。
- [网页验收证据与持久化任务](public-workbench-verification-2026-10-14.json)。本节只补充证据，不改变模型、Risk、Memory 或 Quant 逻辑。

## 第二轮迭代：资金用途、重叠任务与审批后变更

本节为后续迭代的最新结果，保留上面第一轮的历史判断。明确绑定演示资金计划的任务，现在会持续执行资金检查；未接入可信 Memory 或真实账户。

### 已完成的核心接口

- 新增演示资金计划的创建、版本修订、查询，以及 funding-plan-demo.v1 Schema。
- review 提议绑定用途快照与指纹；绑定资金的任务一律要求人工审批。
- 模拟前再查剩余额度与计划版本；回执与占用原子保存，重复请求不重复记账。
- 新增 FUNDING_BLOCKED 终态，任务、执行端与页面统一。接入方需更新状态枚举；旧通用请求不自动具备本轮资金保护。
- 页面突出生活费、已占用、可安排三个数字；解释与日志默认折叠，旧版持仓Demo保留。

### 可验证的集成进度

| 层级 | 最新事实 | 证据 |
| --- | --- | --- |
| 演示覆盖 | 自动测试93项通过，覆盖并发争抢、重复请求、用途改版、文本污染、保存失败、重启恢复、本地HTTP接口 | 新增6项资金保护测试、3项云端测试、1项本地HTTP子测试 |
| 真实接通 | 真实 Workers AI + 公网后端 + 持久化；最终33次HTTP检查、4个真实模型任务通过 | 部署 e39cb48d-4255-4ec5-a970-b3fa31689630；2026-10-14T07:51:25.0783656Z 至 2026-10-14T07:52:17.3432781Z（UTC） |
| Contract校验 | 创建请求、2份计划、4个最终任务与4个交接包共11份校验通过 | 新版公共Schema与公网响应 |
| 联合验收 | Risk/审批仍是脚本或按钮扮演；尚未认证、账户隔离或接入真实网关 | 不宣称跨Owner联合验收完成 |

最终任务：
- `review-task-73d12fff-e038-470f-8e55-089d7e7169bc`：8000元，FUNDING_BLOCKED，FUNDING_CONFLICT。
- `review-task-392274dc-609b-4fef-ab9a-c33d87320c61`：4000元，SIMULATED，模拟成功。
- `review-task-20767bf7-5c4b-4288-8377-e6661ac84104`：4000元，FUNDING_BLOCKED，FUNDING_CONFLICT。
- `review-task-60f5360b-5aab-4b85-b9ef-95d02e315e88`：1000元，FUNDING_BLOCKED，FUNDING_PLAN_CHANGED。

所有任务 execution_allowed=false。初次试跑发现任务总状态未反映资金阻断，已修复、重部署并重新验收；保留初测记录。

### 需要其他 Owner 配合的阻塞项

- Risk：认证回调、独立决策、接收资金证据与新状态。
- Memory：用途的可信确认引用、版本、有效期及撤回协议；本轮未修改 Memory 规则。
- Backend / Approval：正式身份、权限与账户隔离；confirmed=true 只是演示确认。
- Execution：真实账户额度、释放、到期及补偿协议。当前仅同一虚构计划共用额度，不支持真实账户跨计划保护。

[功能说明、架构图与时序图](funding-guard-iteration-2026-10-14.md) · [完整模型与审计响应](public-funding-guard-2026-10-14.json) · [记事本测试结果](../logs/Core-Agent-资金用途保护测试-2026-10-14.txt)。
