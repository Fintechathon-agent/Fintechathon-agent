# Core Agent 临时共创入口

| 内容 | 用途 | 状态 |
| --- | --- | --- |
| [Core／Risk Cloudflare 联调部署](../../chenchen/docs/core-risk-cloud-deployment-2026-10-21.md) | 独立双 Worker、服务端身份、SQLite 审计和原 Risk 规则适配 | 已部署；14 项公网检查、9 项专项通过；模型调用关闭，完整联合验收未完成 |
| [Core／Risk 身份与回调接线准备](../../chenchen/docs/core-risk-callback-setup-2026-10-21.md) | 固定审核人、机器身份、配置预检与 PR #27 兼容验证；公共回调字段不变 | Core 304/304、Risk Node 258/258、Python 16/16、跨模块 5/5；模型替身，尚未部署／联合验收 |
| [投资页设计层接回](../../chenchen/docs/investment-ui-iteration-2026-10-20.md) | 对照团队工作台补回资产总览、风控工作台、重点卡片和分区跳转；保留易读报告和 Risk Handoff 边界 | 本地浏览器实测通过；待团队确认后再进入正式交付区 |
| [易读报告与10000例复测](report-benchmark-v6/DELIVERY.md) | 先结论后细节、TXT导出、中文测试分类、缺资料保护 | 9900→10000/10000，284项回归通过；本地模拟，正式联合验收待完成 |
| [追加10000例：多任务资金与接口边界](integration-benchmark-v5/DELIVERY.md) | 重试字段顺序兼容、旧任务兼容、签名与跨任务回写阻断 | 9750→10000/10000，278项回归通过；本地模拟，未部署生产 |
| [追加5000例：资金与故障恢复](recovery-benchmark-v4/DELIVERY.md) | 原请求重复提交修复、保存失败阻断、迟到回调与重复回执检查 | 4800→5000/5000，274项回归通过；本地替身，未部署生产 |
| [投资 5000 + 其他功能 5000 例](dual-benchmark-v3/DELIVERY.md) | 两批分开验证、资金用途全流程、金额异常格式修复 | 最终各5000/5000，271项回归通过；本地验证，未新增生产接通 |
| [投资助手追加 2000 例验证](investment-benchmark-v2/DELIVERY.md) | 区分评分/时长与金额，复杂意图澄清，审批后改参数阻断 | 2000/2000，新旧两批合计 3000 例复跑通过；268/268 项目回归；本地替身验证 |
| [投资助手 1000 例验证](investment-benchmark-v1/DELIVERY.md) | 小额/否定修复，持仓、资金用途、Risk、审批和审计回归 | 1000/1000 合成案例、264/264 回归通过；真实联合验收仍待接通 |
| [账户汇总核对 v1](account-summary-v1/DELIVERY.md) | 汇总数字核对、缺资料提示、同任务交接与阻断测试 | 258 项回归与严格 Handoff 检查通过；用户原始数据不公开，候选语义待确认 |
| [状态变更与故障恢复 v1](transition-recovery-v1/DELIVERY.md) | 撤回/审批保存失败阻断、共享资金计划保护 | 246 项回归、6 进程磁盘测试通过；正式接入仍待确认 |
| [Risk Handoff 契约修复 v1](owner-integration-v1/DELIVERY.md) | 移除冻结 Schema 不允许的顶层来源编号别名 | 严格 Handoff 检查通过；真实 Risk/审批联合验收仍待确认 |
| [模型服务回执对齐 v1](owner-integration-v1/DELIVERY.md) | 记录供应商响应体或响应头中的真实回执编号 | 247 项回归通过；真实模型调用仍待授权 |
| [能力状态接口 v1](owner-integration-v1/DELIVERY.md) | 对外说明模型、Risk、审批和 PAPER 执行的接通边界 | 249 项回归通过；接口只读，不触发外部调用 |
| [Golden Path 全链路 v1](golden-path-v1/DELIVERY.md) | 合成模型→Risk→审批→PAPER→审计，以及拒绝阻断 | 正常路径与拒绝路径均可复跑；真实联合验收待确认 |
| [旧入口重试与可读审计 v1](retry-audit-v1/DELIVERY.md) | 防重复模型调用、超长约束保护、TXT 任务记录导出 | 232 项回归、5 类本地签名链路验证；正式联合验收待落实 |
| [执行保护与交接候选 v1](execution-guards-v1/DELIVERY.md) | 批准过期阻断、重复回执与审计覆盖修复、字段补丁 | 220 项回归通过；公共接口候选未应用，待双方确认 |
| [任务持久登记与故障恢复 v1](durable-recovery-v1/DELIVERY.md) | 防止重启后重复调用，核查失败记录与 UI 接入条件 | 213 项回归、4 进程磁盘测试通过；正式接入待确认 |
| [Core × Risk 源码联调 v1](owner-integration-v1/DELIVERY.md) | 并发修复、实际风控源码联调、严格接口阻塞证据 | 205 项回归与 9 组本地联调通过；公共接口检查未通过，待双方确认 |
| [生活请求、购物与订阅 v1](life-planning-v1/DELIVERY.md) | 长句核对、报价账单联动、接口与同任务审计测试 | 本地可运行，待联合验收 |
| [待确认清单 v0](conversation-intake/DELIVERY.md) | 旧版原文拆分试验 | 保留，可用于对照与回退 |
| [百炼模型适配](bailian/DELIVERY.md) | 服务端模型接入与预算边界 | 未开通、未授权付费；使用本地替身验证 |

源代码维护在 `chenchen/`，这里登记团队联调入口。测试通过仍需相关模块确认后再进入 `team-release/`。不要在共创文档放密钥、群聊或真实个人资料。
