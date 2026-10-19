# 临时共创 · 投资助手追加 2000 例验证

归属：chenchen/，Core Agent 输入与主链路集成验证。供团队复跑，未进入正式交付区。

- [通俗结果与修复说明](../../../chenchen/docs/investment-benchmark-2000-2026-10-19.md)：1875/2000 → 2000/2000。
- [生成与复跑](../../../chenchen/experiments/investment-benchmark-v2/README.md)：10 组、71 个模板、固定新种子。
- [首轮失败基线](../../../chenchen/docs/investment-benchmark-2000-before-2026-10-19/report.json)、[修复后结果](../../../chenchen/docs/investment-benchmark-2000-after-2026-10-19/report.json)。
- [旧 1000 例兼容性验证](../../../chenchen/docs/investment-benchmark-1000-compatibility-2026-10-19/report.json)、[268 项回归日志](../../../chenchen/docs/investment-benchmark-2000-regression-2026-10-19.txt)。

修复评分/时长单位误当金额、复杂否定和犹豫表达缺少澄清；100 例新增审批后改参数均阻断。公共 Contract、Memory、Quant 和 Risk 规则不变；旧报告与版本保留。

模型、Risk、审批均为本地替身，外部及付费调用 0。尚未完成生产部署或正式联合验收，不用于承诺真实模型准确率和公测就绪。
