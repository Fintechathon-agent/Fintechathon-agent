# Core 任务恢复与防重复调用 · 2026-10-19

状态：临时共创；Core 自身修复已验证，正式跨模块验收未完成，不晋级 team-release。

这次解决“模型已调用，但记录保存失败，重试又调一次”的问题。也保留可查询任务编号，不把未保存的结果当成功。

- [今日更新与交付说明](../../../chenchen/docs/core-agent-daily-update-2026-10-19.md)
- [代码与复跑说明](../../../chenchen/experiments/durable-recovery-v1/README.md)
- [213 项回归记录](../../../chenchen/docs/core-agent-tests-2026-10-19.txt)
- [真实进程中断与磁盘恢复证据](../../../chenchen/docs/core-agent-durable-recovery-2026-10-19.json)
- [实际 Risk 源码本地联调](../../../chenchen/docs/core-risk-local-integration-2026-10-19.json)
- [严格 Handoff 接口仍失败的证据](../../../chenchen/docs/core-risk-contract-blocker-2026-10-19.json)
- [UI 接入对照](../../../chenchen/docs/core-agent-ui-readiness-2026-10-19.md)
- [线上部署回执](../../../chenchen/docs/core-agent-deployment-2026-10-19.json)

前端沿用 POST /api/review；一项操作保存一个稳定幂等键。503 且 retryable=false 时显示“记录待核查”，保留任务编号，不换键连续重发。不新增公共状态，不开放审批或交易权限。

未配置正式 Risk 服务时仍阻断。来源任务字段与供应商回执编号的接口差异仍需双方确认；真实账号身份、百炼付费测试未完成。测试资料全部虚构，付费模型调用 0。
