# 首页 01 卡片入口调整 · 2026-10-22

按用户指定位置，将首页 01 卡片底部“查看风险报告”改为“产品导航”，链接由 `investment.html#results` 改为 `catalog.html`，进入已有产品导航二级页面。

本轮只修改该链接和首页发布摘要。没有改动卡片其他内容、透明 Logo、导航层级或后端。

本地及线上检查 320、375、840、1440px：入口文字正确，点击后进入产品导航页、当前导航标记正确，页面无脚本异常及横向溢出。结果与截图见 `local.json`、`online.json` 及同名前缀 PNG。

JavaScript 语法检查、Worker 编译及发布文件摘要核对通过；部署保留现有配置。本轮没有发起真实模型调用。发布版本及线上文件校验见 `deployment.json`。

线上入口：https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/landing?v=20261022-catalog#explore
