# P0 UI 实施与安全集成交付

日期：2026-10-14。状态：本地可测试版本；未推送、未合并、未部署。完整闭环仍待正式 Risk、审批和 PAPER 接口联调。

## 代码与来源

- 团队仓库：https://github.com/Fintechathon-agent/Fintechathon-agent.git
- 分支：`feat/ui-unified-workspace-v1`。
- 开始实施时 fetch 确认的 main 基线：`8b3922edf314bc8e3ab95602fe86b2a20ac5bd0d`。
- 收尾 fetch 的 main：`55b8978cd267064d5a972059a925b624e69d95fd`，新增 8 个提交、40 个文件变化。未自动合并。变更涉及 review adapter、guard、Cloudflare 和 qiqi 金融计算，需在 P1 复核，不是本轮已验收代码。
- 原个人工作区 `F:\人工智能AI 比赛` 的未提交资产保持不动；实施在独立 worktree。未整体复制个人脏工作区。
- K Logo 与 tokens.css 从已提交版本 `e218efe189b5fff8a85681da20c9bc137c361294` 原样复用，没有重新绘制 Logo。

## 前后差异与实际能力

|之前|本轮|
|---|---|
|功能入口分散|工作台、银行业务、我的任务、安全与记录四个一级模块|
|投资组合结果与任务脱节|输入、诊断、A/B（保留 C）比较、Risk、审批、PAPER、审计七步骤|
|技术入口与主要业务混排|Portfolio 优先，技术入口折叠，商家保持独立目录路由|
|状态容易混淆|来源、Risk、审批、执行分别显示；HTTP 200 业务错误也按失败处理|
|页面结果可能滞后于输入|输入变更使旧结果失效；迟到响应不能覆盖新输入|
|零散证据|同一 Core task_id 的只读任务详情与审计；失败时不沿用旧事件|

已接入：本地 Node investment-agent.v1 健康检查、方案比较、任务读取和审计读取。服务真实运行，但输入/市场样例属于 DEMO / FIXTURE，不标记为 LIVE。自然语言输入仅保存目标草稿，不宣称智能体已理解或执行。没有新业务能力。

保留 `/`、`/investment`、`/investment-v0.10`、`/risk-workbench`、`/merchant`、`/catalog`。商家不出现在默认个人主导航。转账与订阅不伪装成已接通。

Risk、审批与 PAPER 组件当前为只读或待接入。缺回执、任务不匹配和未识别执行状态显示 UNKNOWN；不会自动重试交易。审批通过不等于成交。无副作用模拟回执明确不改变 PAPER 账本。浏览器异常状态验收使用显式 TEST FIXTURES，不是后端业务验收。

## 修改文件

UI：`chenchen/versions/investment.html`、`investment.js`、`home.html`、`common.js`。
新增展示层：`workspace.js`、`workspace-model.mjs`、`workspace.css`、`tokens.css`、`team-logo-transparent.png`（均在 versions 下）。
静态服务：`chenchen/server.js` 仅添加 PNG MIME 与 UI 资产白名单，API 逻辑不变。
检查与构建：`chenchen/scripts/workspace-model.check.mjs`、`workspace-browser-check.cjs`、`build-workspace.cjs`。
文档：本文件、`docs/contract-proposals/2026-10-14-ui-workspace-adapters.md`、`review/ui-p0/` 证据。
Core、Tools、merchant、data、qiqi、Risk 业务源码及公共 Contract 没有本轮修改。

## 验证结果

|检查|修改前/参照|本轮结果与边界|
|---|---|---|
|团队 Node/Core 套件|63/63|63/63，基于本轮 8b3922e 分支|
|UI 状态模型|新检查|11/11|
|Chrome 实际交互|新检查|15/15；无 JS 错误|
|Axe|新检查|四个主要视图 0 违规；不代表完整人工无障碍认证|
|响应式|新检查|1440 桌面及 1024/390/375 宽度验证|
|qiqi Python/Tools|上轮 95/95|本轮基线重跑 95/95；不是最新 main 的 115 项验收|
|Risk 独立快照|102/102|重跑 102/102，固定 f232a0fbf48d7e27bffa19371b5d2f55682fec2c，未合入 main|
|原个人 UI|44/45|仍为 44/45：旧首页“个人投资顾问”文案断言；未删除或修改 Owner 测试|
|语法/构建|可用检查|语法检查通过；12 资产 overlay 构建，无 API mock；不是独立静态部署包|
|运行态 smoke|原有脚本|路由和资产与源码一致|

日志及截图位于 [ui-p0](ui-p0/README.md)。浏览器只验证本地 Chrome；未宣称移动真机、Firefox/WebKit 或公开部署验收。最初 Python 测试目录选择错误已纠正后重跑；样式对比度问题已修复并重跑。

## P1 协调与顺序

金怡含：最新金融指标/基金能力和 Python review 输出、单位、账本与回执边界。
林粹/Core：最新 legacy adapter 的正式使用方式、任务关联、认证、部署与 Gateway guard。
Vesper：正式 Risk 决策/原因、只读导入映射、source_task_id 与本地 task_id。
Memory/Audit Owner：持久化、跨会话恢复和身份隔离。

详细接口差异见 [适配提案](../docs/contract-proposals/2026-10-14-ui-workspace-adapters.md)。推荐：确认最新接口 → 安全迁移最新 main 增量 → 单任务只读贯通 → 服务端确认与 PAPER 接通 → 异常/幂等/账本对账 → 经用户确认推送独立分支。本轮不因新 main 出现而擅自合并。

## 复验方式

以下命令在项目根目录运行，用于状态模型、浏览器和资产构建检查；Node 要求 >=22，浏览器检查需要现有 playwright、@axe-core/playwright 与 Chrome。

```powershell
node --test chenchen/scripts/workspace-model.check.mjs
$env:UI_MODULE_ROOT='F:\人工智能AI 比赛\chenchen\node_modules'
node chenchen/scripts/workspace-browser-check.cjs
node chenchen/scripts/build-workspace.cjs
```

在 chenchen 目录执行 `node --test` 与 `node scripts/check.js`。启动本地 server 后执行 `node scripts/smoke.js`，端口通过 PORT 指定。预览进程停止后可用 `node server.js` 重新启动。
