# 第三阶段：Finance Lab 完整网站本地集成交付

## 状态与入口

已完成本地集成，等待视觉与交互验收。未推送、未创建 PR、未修改线上网站或团队 main。

预览：http://127.0.0.1:4187/index.html 。当前仅绑定本机。进程停止后，在本分支 chenchen 目录运行 `node server.js`，默认端口为 4175。

```mermaid
flowchart TD
  Index[index.html] --> Landing[landing.html 原品牌首页]
  Root[/ 根入口] --> Landing
  Landing --> Workspace[workspace.html 唯一 Unified Workspace]
  Workspace --> Landing
  Workspace --> Banking[银行业务：投资组合健康检查]
  Workspace --> Tasks[我的任务：只读 Risk 与审计]
  Workspace --> Safety[安全与记录]
  Safety --> Investment[investment.html 原投资顾问]
  Workspace --> Catalog[catalog.html 辅助目录]
  Catalog --> Investment
  Catalog --> Legacy[investment-v0.10 历史页]
  Catalog --> Merchant[merchant.html 独立商家]
  Catalog --> Risk[risk-workbench 独立技术演示]
  Investment --> Workspace
  Legacy --> Workspace
  Merchant --> Workspace
  Risk --> Workspace
  Catalog --> Landing
```

主业务页同时有返回品牌首页入口。Workspace 点击品牌 Logo 可返回 Landing（移动端同样可用）；桌面侧栏另有文字返回入口。没有 iframe，也没有复制第二套 Workspace。

## 实际代码来源与兼容处理

- 团队仓库：https://github.com/Fintechathon-agent/Fintechathon-agent.git。
- 开始时 fetch 的 main：`55b8978cd267064d5a972059a925b624e69d95fd`；收尾再次 fetch 至 `3dfa86b3114de46d1d0b0abc3ff664c88f4757ac`。新增提交仅涉及 qiqi/brief 的日报、PDF 和数据集，不重叠 UI 或服务业务源码；本地提交后安全变基纳入，未修改该增量。
- 新本地分支：`codex/ui-site-integration-v1`，从 55b8978 创建，最终基于 3dfa86b。
- P0 源提交：`d067b3810802792cd7646ec214491b7afa9c95d0`；初次本地迁入提交为 `90051ce`（随最终变基重写）。迁入没有文本冲突，server.js 静态资源修改自动兼容，随后人工核查 API 区域与最新 main 完全相同。
- 保留 main 新增的 legacy review adapter、风控 guard、Cloudflare 实现、qiqi 指标/基金/历史验算更新，没有用旧版本覆盖。
- Landing、landing.css、landing.js、archive.js、glass.css、favicon.svg 来自已提交 `e218efe189b5fff8a85681da20c9bc137c361294`。保留原叙事、K 动效、网格背景、天平交互及品牌资产；只修改入口和两张功能卡的业务定位。第二张卡指向任务记录，商家仍在独立目录。
- 保留 K PNG 原文件与既有 tokens；Workspace 和保留业务页沿用 Landing 字体栈、黑灰橙与按钮/卡片语言。
- `F:\人工智能AI 比赛` 中未提交资产未迁移或覆盖，原 P0 分支也未修改。本次完整网站使用明确已提交的品牌版本，未声称包含个人目录全部候选修改。

## 路由及上下文

|路径|本轮行为|
|---|---|
|`/`、`/landing`、`/landing.html`|原品牌首页|
|`/index.html`|跳转 landing.html，保留无脚本链接|
|`/workspace`、`/workspace.html`|唯一 Unified Workspace|
|旧 `/#workspace`、`/#banking`、`/#tasks`、`/#safety`|前端转向 workspace.html 的对应区块|
|`/investment`、`/investment.html`|最新 main 原投资顾问；不再塞入另一套 Workspace|
|`/investment-v0.10`、`/investment-v0.10.html`|原历史投资页|
|`/merchant`、`/merchant.html`|独立模块|
|`/catalog`、`/catalog.html`|辅助目录|
|`/risk-workbench`、`/risk-workbench.html`|原技术演示，不能视为 Workspace 当前任务的审批入口|

同一标签页的 sessionStorage 仅保留 Core task_id，按部署路径隔离；返回 Workspace 后重新查询服务、只读恢复并提示历史记录。未缓存审批、回执或成功数据，不继承其他工具的授权；输入草稿不会伪装成已提交任务。服务重启造成内存任务不可读取时显示 ERROR。

新增静态构建只复制前端，按项目子路径生成相对链接，不打包后端、不拦截 API、不生成模拟成功。GitHub Pages 没有后端时明确不可用；实际 Pages 部署、跨域配置与公开后端均未验证。

## 测试与未通过项

|检查|结果|
|---|---|
|新 main + P0 迁入后、网站改动前 Node 套件|75/75|
|网站集成后原 Node 套件|73/75；2 个失败统计项来自同一个旧页面资产子测试及其父测试|
|当前网站 HTTP 页面与 MIME 检查|1/1；13 个路由及引用资产均返回正确类型|
|P0 浏览器回归|15/15，无 JS 错误|
|完整网站 A–G 与子路径|8 组通过，包括同任务返回读取、服务故障、全部主要页返回入口|
|UI 状态模型|11/11|
|最新 main Python 套件|115/115|
|Axe|Landing、Workspace、原投资页均 0 违规；P0 四视图也为 0|
|桌面与移动|1440 桌面、390/375 完整网站；P0 回归包含 1024/390/375|
|语法、运行态 smoke、UI 构建|通过|
|Core/Tools/Contract/Integration/qiqi/Cloudflare/Gateway 与 main 差异|没有业务源码变更；API 处理函数逐段比对相同|

**未通过原因**：`chenchen/tests/http.test.js:20` 要求所有旧页面（包括根路径）加载 product-overrides.css，并假定非 CSS 资产全部是 JavaScript。根路径现在是原 Landing，使用 landing.css/glass.css，并有 PNG/SVG 品牌资源，该旧 UI 断言不再适用。没有删除/修改 Owner 测试，也未为凑通过率给 Landing 加不适用的样式。新增 site-http-check.cjs 按真实页面和资源类型验证，保留原失败日志。PR 前建议由该测试 Owner 审核将根页面资产预期更新为 Landing，图片按实际 MIME 校验；业务、安全和权限断言保持不变。

这是本地前端集成验收，不是正式 Risk 决策、PAPER 成交或 Audit 持久化验收。Risk 缺正式响应时仍显示等待，审批与执行仍待接口，旧技术工具的独立演示能力未自动升级为工作台权限。没有真实资金操作。

## 文件清单

新增页面与资源：`chenchen/versions/index.html`、`landing.html`、`landing.css`、`landing.js`、`archive.js`、`glass.css`、`favicon.svg`、`workspace.html`、`workspace-investment.js`、`site-context.mjs`、`site-shell.css`。

修改前端：`common.js`、`home.html`、`investment.html`、`investment-legacy.html`、`merchant.html`、`risk-workbench.html`、`workspace.js`、`workspace.css`。`investment.js` 从 P0 恢复为最新 main 原实现，P0 控制器移到 workspace-investment.js。

静态服务：`chenchen/server.js` 只调整页面路由、资产白名单及 PNG/SVG MIME。

检查与构建：`chenchen/scripts/build-site.cjs`、`site-browser-check.cjs`、`site-http-check.cjs`；更新 `build-workspace.cjs`、`workspace-browser-check.cjs` 和 `smoke.js` 的真实入口。

文档与证据：本文件及 `review/site-integration/`。`review/ui-p0/` 为上轮历史证据，不能替代本轮结果。

## 实际浏览器截图

- [保留后的 Landing 桌面](site-integration/landing-desktop.png)
- [升级 Workspace 桌面](site-integration/workspace-desktop.png)
- [Landing 移动端](site-integration/landing-mobile.png)
- [Workspace 移动端](site-integration/workspace-mobile.png)
- [原投资页移动端](site-integration/investment-mobile.png)
- [方案比较](site-integration/portfolio-desktop.png)
- [只读 Risk](site-integration/risk-readonly-desktop.png)
- [服务失败](site-integration/service-error.png)

截图采用本地 Chrome；截图中 DEMO/FIXTURE 不表示正式线上验收。网站交互测试包含显式故障拦截；P0 状态回归里的测试 fixture 仅用于组件检查。

## 后续 PR 方案（尚未创建）

建议标题：`feat(ui): integrate unified workspace into Finance Lab website`。
基线 main；来源分支 codex/ui-site-integration-v1。PR 描述聚焦品牌首页保留、统一工作台升级、兼容入口、只读上下文和失败状态。

1. 用户验收本地完整视觉与主要路径。
2. Core/测试 Owner 审核根页面资产断言变更；金怡含、林粹、Vesper 分别确认接口部署、任务关联及只读 Risk 边界，不在 UI 中补安全规则。
3. 发布前再 fetch，核对新 main；出现重叠变更先审查，不能直接覆盖。
4. 用户授权后仅推送工作分支、创建待审 PR，附本轮截图、日志与接口限制；不直接推送 main，不自动合并或覆盖线上。
5. 静态页面发布与后端正式联调分开验收。确定 Pages/同源服务策略后再实际验证公开入口。
