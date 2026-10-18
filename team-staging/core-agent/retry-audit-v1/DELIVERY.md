# Core 旧入口重试与可读审计 · 2026-10-19

临时共创交付，未完成正式联合验收，不晋级 team-release。旧版本保留。

- [本轮做了什么、还缺什么](../../../chenchen/docs/core-agent-retry-audit-2026-10-19.md)
- [接入和导出使用方法](../../../chenchen/experiments/retry-audit-v1/README.md)
- [正常模拟任务的 TXT](../../../chenchen/docs/core-agent-retry-audit-evidence-2026-10-19/approved/任务记录.txt)
- [全部虚构案例与请求/响应](../../../chenchen/docs/core-agent-retry-audit-evidence-2026-10-19/verification.json)
- [232 项测试结果](../../../chenchen/docs/core-agent-retry-audit-tests-2026-10-19.txt)
- [修复前失败记录](../../../chenchen/docs/core-agent-retry-audit-before-2026-10-19.txt)
- [线上版本与部署回执](../../../chenchen/docs/core-agent-retry-audit-deployment-2026-10-19.json)

旧入口重试不再重复调用模型，超长问题不再被截断。导出工具只读本地文件，不联网、不改任务，不自动发布真实财务信息。正式字段、回调地址、可信身份和供应商回执编号仍需对应模块落实。
