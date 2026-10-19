# Core Agent Golden Path v1

## 交付内容

- [可复跑脚本](../../../chenchen/experiments/golden-path-v1/run.mjs)
- [运行说明](../../../chenchen/experiments/golden-path-v1/README.md)
- [测试证据](../../../chenchen/docs/core-agent-golden-path-tests-2026-10-19.json)
- [逐步运行日志](../../../chenchen/logs/core-agent-golden-path-2026-10-19.jsonl)

## 验收边界

本地合成数据已覆盖：模型提议、Risk Handoff、Risk 通过、人工审批、PAPER 模拟执行、完整审计回放，以及 Risk 拒绝后的执行阻断。所有步骤共用同一个任务编号、运行编号、审计编号和提议指纹。

本轮没有真实模型调用、正式 Risk 请求、可信审批身份或真实执行网关；不能把本地 PASS 写成联合验收。公共 Schema、Risk 规则、`team-release/` 和其他 Owner 文件未修改。

