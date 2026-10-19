# 投资助手追加 10000 例：多任务资金与接口边界

交付日期：2026-10-19。首轮 9750/10000，修复后同输入 10000/10000；完整回归 278/278。保留前后证据及历史版本。

- [完整报告](../../../chenchen/docs/benchmark-10000-integration-2026-10-19.md)
- [通俗版 TXT](../../../chenchen/docs/benchmark-10000-integration-summary-2026-10-19.txt)
- [一致性核验](../../../chenchen/docs/benchmark-10000-integration-verification-2026-10-19.json)
- [测试入口](../../../chenchen/experiments/integration-benchmark-v5/run.mjs)

修复等价 JSON 请求仅改变字段排列就被拒绝重试的问题；旧任务的原请求仍兼容，金额/内容变更和未完成持久登记继续阻断。67种参数化模板、10000组不同完整输入，包括2500条多任务资金与2500条签名/任务归属检查。

实际运行本地 Core/Worker 代码，模型与风控为替身，账户虚构，零外部/付费调用。真实服务接通、生产部署与联合验收本轮未新增。正式交付区未改动，其他成员目录未改动。
