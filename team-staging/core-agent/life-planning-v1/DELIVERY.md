# Core Agent · 生活请求与购物订阅共创版

- 维护账号：`realchenchenluo`。
- 位置：临时共创区，允许团队联调；未转为正式交付。
- 来源基线：团队 main `13f6230f13ea45d38fdd31cfc88fab0657762bd1`。
- 实现与使用说明：[chenchen/experiments/life-planning-v1](../../../chenchen/experiments/life-planning-v1/README.md)。本目录只提供入口，需克隆完整仓库。
- 运行：仓库根目录执行 `node team-staging/core-agent/life-planning-v1/run-demo.js`。本地接口服务执行 `node chenchen/experiments/life-planning-v1/server.js`，查看 `http://127.0.0.1:4181/fixture`。
- 证据：[交付与待联调清单](../../../chenchen/docs/core-agent-life-planning-2026-10-17.md)、[测试记录](../../../chenchen/docs/life-planning-tests-2026-10-17.txt)。

## 当前状态

演示覆盖：长句拆分与更正、最终语音转写核对、购物报价与订阅合计、同一版本确认、共享报告数据，以及替身模型→Risk回调→审批→模拟→审计。

真实系统：本轮没有新增联网模型、平台报价、语音识别、真实账户或执行接口。本地请求草稿沿用 `model-review.v1`，正式网关未配置时的阻断保留。此前公网服务没有改部署。

联合验收：尚未进行。UI需接核对交互；数据侧需提供报价、订阅和事实来源；Risk需确认正式回调与身份；报告渲染由共享契约对接。

所有示例是虚构数据。文本/计划确认不构成 Risk 放行或 Memory 同意。新实验不修改其他模块、不重算 Quant、不修改 Memory 规则，不自动进入正式区。

旧 `conversation-intake` v0 及其入口仍可运行。回退采用历史提交建立恢复分支，不强制重置、不删除共享成果。
