# Core Agent 临时共创入口

| 内容 | 用途 | 状态 |
| --- | --- | --- |
| [状态变更与故障恢复 v1](transition-recovery-v1/DELIVERY.md) | 撤回/审批保存失败阻断、共享资金计划保护 | 246 项回归、6 进程磁盘测试通过；正式接入仍待确认 |
| [Risk Handoff 契约修复 v1](owner-integration-v1/DELIVERY.md) | 移除冻结 Schema 不允许的顶层来源编号别名 | 严格 Handoff 检查通过；真实 Risk/审批联合验收仍待确认 |
| [旧入口重试与可读审计 v1](retry-audit-v1/DELIVERY.md) | 防重复模型调用、超长约束保护、TXT 任务记录导出 | 232 项回归、5 类本地签名链路验证；正式联合验收待落实 |
| [执行保护与交接候选 v1](execution-guards-v1/DELIVERY.md) | 批准过期阻断、重复回执与审计覆盖修复、字段补丁 | 220 项回归通过；公共接口候选未应用，待双方确认 |
| [任务持久登记与故障恢复 v1](durable-recovery-v1/DELIVERY.md) | 防止重启后重复调用，核查失败记录与 UI 接入条件 | 213 项回归、4 进程磁盘测试通过；正式接入待确认 |
| [Core × Risk 源码联调 v1](owner-integration-v1/DELIVERY.md) | 并发修复、实际风控源码联调、严格接口阻塞证据 | 205 项回归与 9 组本地联调通过；公共接口检查未通过，待双方确认 |
| [生活请求、购物与订阅 v1](life-planning-v1/DELIVERY.md) | 长句核对、报价账单联动、接口与同任务审计测试 | 本地可运行，待联合验收 |
| [待确认清单 v0](conversation-intake/DELIVERY.md) | 旧版原文拆分试验 | 保留，可用于对照与回退 |
| [百炼模型适配](bailian/DELIVERY.md) | 服务端模型接入与预算边界 | 未开通、未授权付费；使用本地替身验证 |

源代码维护在 `chenchen/`，这里登记团队联调入口。测试通过仍需相关模块确认后再进入 `team-release/`。不要在共创文档放密钥、群聊或真实个人资料。
