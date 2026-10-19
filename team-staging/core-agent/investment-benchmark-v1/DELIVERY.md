# 临时共创 · 投资助手 1000 例验证

负责范围：Core Agent 输入、编排与集成验证。当前可供团队复跑，不进入正式交付区。

- [结果与修复说明](../../../chenchen/docs/investment-benchmark-1000-2026-10-19.md)：870/1000 → 1000/1000；相同数据、预期与测试程序。
- [测试程序和数据生成方法](../../../chenchen/experiments/investment-benchmark-v1/README.md)：10 组、46 个模板、1000 个虚构参数化案例。
- [修复后逐例结果](../../../chenchen/docs/investment-benchmark-1000-after-2026-10-19/report.json)与[有效失败基线](../../../chenchen/docs/investment-benchmark-1000-baseline-final-2026-10-19/report.json)。
- [内部试用指南](../../../chenchen/docs/investment-internal-trial-guide-2026-10-19.md)。

修复只进入本地 life-planning-v1：小额完整识别与否定语义处理。原 v0、网页、生产 Worker、冻结公共接口、Quant/Memory/Risk 规则保留。现有 Cloudflare 后端健康，正式 Risk、可信审批身份、截图自动识别与公测额度仍待接通。模型与风控测试替身不等于真实联合验收；GitHub 不包含原始会议、身份映射或实际财务数据。
