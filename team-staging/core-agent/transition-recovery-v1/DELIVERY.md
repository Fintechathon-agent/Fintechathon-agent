# Core 状态变更保存与故障恢复 · 2026-10-19

临时共创交付，未晋级正式交付区。已验证 Core 自身故障保护，正式模型/Risk/身份联合验收仍未完成。

- [给团队的说明与待落实事项](../../../chenchen/docs/core-agent-transition-iteration-2026-10-19.md)
- [实现、复跑与回退条件](../../../chenchen/experiments/transition-recovery-v1/README.md)
- [246 项测试结果](../../../chenchen/docs/core-agent-transition-tests-2026-10-19.txt)
- [修复前失败记录](../../../chenchen/docs/core-agent-transition-before-2026-10-19.txt)
- [3 类强制退出、6 进程磁盘恢复证据](../../../chenchen/docs/core-agent-transition-recovery-2026-10-19.json)
- [固定 Risk 源码的 9 组本地联调](../../../chenchen/docs/core-risk-transition-integration-2026-10-19.json)
- [严格接口仍失败的证据](../../../chenchen/docs/core-risk-transition-blocker-2026-10-19.json)

一句话：撤回、拒绝、审批或模拟结果未存清楚时，不能用旧状态继续；共用资金计划的任务也不能抢用旧余额。全部输入与模型响应均为合成测试数据。
