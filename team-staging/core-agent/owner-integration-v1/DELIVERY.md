# Core Agent × Risk 本地源码联调 v1

日期：2026-10-19 更新。状态：**临时共创；Handoff 严格格式已通过，真实联合验收仍未完成，不进入正式交付区**。

## 这一轮能交给队友看什么

- [通俗说明与待对齐清单](../../../chenchen/docs/core-agent-integration-iteration-2026-10-18.md)
- [运行方法与源代码](../../../chenchen/experiments/owner-integration-v1/README.md)
- [9 组本地联调证据](../../../chenchen/docs/core-risk-local-integration-2026-10-18.json)
- [205 项回归日志](../../../chenchen/docs/core-agent-iteration-2026-10-18-tests.txt)
- [严格接口失败证据](../../../chenchen/docs/core-risk-contract-blocker-2026-10-18.json)
- [本轮严格 Handoff 通过证据](../../../chenchen/docs/core-risk-handoff-contract-2026-10-19.json)
- [本轮代码提交、部署版本与公网检查](../../../chenchen/docs/core-agent-handoff-contract-deployment-2026-10-19.json)
- [模型回执编号测试记录](../../../chenchen/docs/core-agent-model-receipt-tests-2026-10-19.txt)
- [模型回执版本部署与公网检查](../../../chenchen/docs/core-agent-model-receipt-deployment-2026-10-19.json)

已修复重复请求重复调用模型、晚到风控响应覆盖撤回/拒绝/模拟回执，以及错误响应误当接收成功的问题。测试使用虚构资金和模型替身；实际运行团队 Risk 源码，未重写其规则。

## 联调顺序与剩余阻塞

1. Handoff 顶层多余的 `source_task_id` 已移除；来源编号仍在 `reviewed_input.source_task_id` 与原工作流记录。若消费者必须读取顶层字段，须共同升级版本，不能改回冻结 Schema。
2. 确认供应商回执编号要求：Core 允许缺失，当前 Risk 消费者会拒绝；不能伪造编号。
3. 配置正式 Risk 接收地址、签名回写与可信审批身份，联合测试拒绝、修改、超时、重复和重启场景。
4. 提供经授权的账户/记忆证据，完成真实模型测试授权与预算设置后再验真实链路。

模型只提建议。Risk 拒绝、待审批、缺正式网关时，执行仍阻断。这里不承诺真实扣款、购买或自动取消订阅。Web 界面保持现状。

后端：[现有服务说明](https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/docs)。部署回执见 [部署记录](../../../chenchen/docs/core-agent-deployment-2026-10-18.json)。
