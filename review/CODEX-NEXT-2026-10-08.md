# Finance Lab · 给 Codex 的接续清单（2026-10-08，v4）

> 放置位置：`review/CODEX-NEXT-2026-10-08.md`。由 Claude 整理，供 Codex 接着推进。
> 依据：组长 邹昕成 Sean Zou 的两条群消息 + 团队 PPT《Personal AI Fund Manager · 团队架构 · 职责分工 · 协同机制》（12 页）+ 用户 2026-10-08 12:21 / 12:25 的答复 + 仓库内 `docs/safety-risk-eval/权限风控规划表-v0.2.md`（潘心恬）。

## ★ 用户已拍板（2026-10-08）
1. **截止：本周日 2026-10-11 晚 20:00 前**（用户暂定）。
2. **店主财务助手不保留**在比赛演示里。
3. **后端代码暂时不归用户负责** → 后端只读（见 0.2）。
4. **用户负责的部分（产品交互与演示）在用户这边优先级最高。**
5. **当前投资资产覆盖股票、基金 / ETF**；产品推荐与对比按这两类设计。**银行理财产品是后续扩展**，本轮不做，界面最多预留“后续扩展”的位置，不放假数据。
> 入库时本地与远程 `codex/kosx-landing-glass` 均为 `ed9064b`（本文件随后的文档提交除外）；开工先 `git fetch` 核对。
> 本文件只记录进度、边界和待办，**不是团队 Contract**。

---

## 0. 开工前必读（硬规则，违反即停下报告用户）

### 0.1 团队、模块与 Owner（来自团队 PPT 第 06–07 页）
团队 5 人、5 个模块，每个模块只有一个 DRI。治理规则：**单点责任制；模块内部实现归 Owner；跨模块协议归 Architect；输出不符合 Contract，由对应 Owner 修复。**

| 模块 | Owner | 负责 | 不负责 | 验收标准 |
|---|---|---|---|---|
| 产品与系统架构 | 邹昕成（队长 / PM / Architect） | PRD、Golden Path、Orchestrator、接口协议；项目范围、接口冻结、最终集成、答辩材料 | 模块内部实现 | 主链路跑通；Contract 清晰；状态可追踪 |
| Agent 核心与记忆 | 陈金宝 | Runtime、Session、Context、Memory、Checkpoint | 金融投资决策 | Context 一致；Checkpoint 可恢复；Memory 生效 |
| 工具与金融数据 | 金怡含 | 行情 / 新闻 / 财报、Portfolio Facts、Backtest、Paper Trade | 最终投资建议 | 数据可调用；事实可解释；模拟有结果 |
| 安全风控与评测 | 潘心恬（Vesper） | 权限分级、风险阈值、拦截、Approval、Eval Case；风险状态、阈值规则、审批机制、评测用例 | 收益承诺 / 真实下单 | Risk 状态稳定；能拒绝越权动作；日志完整 |
| **产品交互与演示** | **李想（吉林动画学院 · 戏剧影视导演）** | **Web UI、状态可视化、证据展示、Demo Story** | **后端业务逻辑** | **Recommendation、Risk、Approval 可展示并回传** |

**用户的模块是“产品交互与演示”**（PPT 中吉林动画学院成员李想的模块；用户若更正，以用户为准）。所以 Codex 的工作范围是 **Web UI、状态可视化、证据展示、Demo Story**，**不写后端业务逻辑**。

### 0.2 公共 Contract 规则（组长群消息 + PPT 第 09 页“接口冻结检查”）
原意：可以私下快速沟通、对接接口、排查问题，但**不能私自修改，也不能口头约定后直接改变公共 Contract**。涉及 **Golden Path、API / Shared Schema、Risk 状态、Approval Logic、Audit Log、核心数据结构** 的变更，必须先在群里或飞书 Wiki 留记录，由对应 Owner 确认后再 merge。

| Contract | 确认人 | 本仓库对应位置（Claude 的映射） |
|---|---|---|
| Golden Path | 邹昕成 | 见 0.3 节；投资工作台主流程 |
| API / Shared Schema（跨模块协议） | 邹昕成 | `chenchen/server.js` 的 `/api/*` 路由、请求与响应结构、错误码；ToolResult / ActionProposal 结构 |
| Risk 状态（ALLOW / REVIEW / BLOCK / ERROR） | 潘心恬 | `core/harness.js` 的 `status`、`risk_decision_id`、`REQUIRED_RISK_FIELDS`；`docs/safety-risk-eval/权限风控规划表-v0.2.md` |
| Approval Logic | 潘心恬 | `approval_id`；`paperTrade()` 的审批要求；`/api/paper-trade/execute` 固定 503（“Safety Action Gateway 尚未接入”） |
| Audit Log | 潘心恬（日志完整）+ 邹昕成（字段属跨模块协议）——推断，两人都确认最稳 | `harness.addEvent()` 事件结构、`GET /api/audit/:task_id` |
| 核心数据结构 | 按归属：Session / Context / Memory / Checkpoint → 陈金宝；Portfolio Facts / Backtest / Paper Trade → 金怡含 | `core/harness.js`、`core/memory.js`、`tools/financial-tools.js`、`data/demo-portfolio.json` |

**Codex 在本仓库的读写边界（按上表推出，用户若另有约定以用户为准）：**
- **可以直接改（用户自己的模块）**：`chenchen/versions/*`（页面、样式、前端脚本）、`chenchen/scripts/*-check.cjs`（UI 检查）、`chenchen/scripts/build-static.cjs`（静态演示构建）、`review/`、`screenshots/`、`implementation-notes.md`、新的 UI 原型和文档。
- **只读，不改**：`chenchen/core/`、`chenchen/tools/`、`chenchen/merchant/`、`chenchen/data/`、`chenchen/server.js` 的 `/api/*` 逻辑、`docs/safety-risk-eval/`。
- 需要后端新字段或新接口时：**不要自己在后端加，也不要在前端伪造**。在 `docs/contract-proposals/YYYY-MM-DD-<主题>.md` 写需求（要什么字段、给哪个界面用、样例 JSON、谁确认），提交后停下，请用户发到群里或 Wiki。Owner 确认后，再按确认版本接线。
- 别人模块的输出不符合 Contract 时：记录现象和复现步骤（写成提案或 Issue 草稿），**不在前端打补丁掩盖**，由对应 Owner 修复。
- 不确定算不算 Contract，就按 Contract 处理，并问用户。

### 0.3 Golden Path（PPT 第 03–04 页，组长定义）
**一条主链路支撑比赛演示：**
1. 导入持仓：CSV / 手动输入
2. 数据标准化：代码 / 行业 / 权重
3. 指标计算：集中度 / 波动 / 相关性
4. 规则风控：ALLOW / REVIEW / BLOCK
5. 调整模拟：A / B / C 方案比较
6. 解释审批：证据 + 用户确认 + 日志

V1 只证明一件事，Portfolio Health Check：诊断持仓 → 解释风险 → 生成候选调整 → 回测 / 情景验证 → 风险检查 → 用户审批 → 模拟交易 → 日志留痕。

- 输入：持仓明细（代码、数量、市值 / 权重）；用户约束（风险偏好、禁投行业）；数据源（行情、新闻、财报、指数基准）。
- 计算输出：Health Score 与风险标签；行业集中度、单资产上限、相关性；回撤、波动、基准对比、证据链。
- 决策输出：A / B / C 候选方案，**不自动交易**；Agent Explanation（风险来源与证据）；Human Approval 与 Audit Log。

> 店主财务助手：PPT 主线没有它，**用户已决定不保留**。处理方式见第 3 节 P0-C。

### 0.4 系统边界与设计红线（PPT 第 03、05、06 页）
- **Code calculates. Rules constrain. LLM interprets. Human approves.** 金融计算、风险判定、执行权限都由确定性模块处理；LLM 只做解释与编排。
- **真实资金不接入；核心指标不由 LLM 编造；关键动作必须可追踪。**
- 设计红线：不接真实资金；不无依据荐股；不绕过审批；所有关键输入、指标、建议、审批和时间戳必须可复盘。
- Human Approval：任何调仓、模拟交易、状态变更都必须经过用户明确确认。界面要说清“为什么建议、依据是什么、风险在哪里”，最终授权在人。
- 风险状态的含义：
  - ALLOW：可进入解释 / 模拟（低风险、规则未触发）。
  - REVIEW：需要用户确认（集中度、相关性、新闻冲击等触发）。
  - BLOCK：禁止执行或不给动作建议（越权、真实交易、缺数据或高风险）。
  - ERROR：流程异常降级处理（数据不可用、接口超时、Schema 不匹配）。
- Codex 自己也受约束：不编造交易结果、账户信息、测试结果；没跑过的检查不能写“通过”。

### 0.4b 潘心恬《权限风控规划表 v0.2》里和用户模块直接相关的要求
文件：`docs/safety-risk-eval/权限风控规划表-v0.2.md`（2026-09-24，状态“第四板块提案已确定，跨模块待团队确认”，**不是已冻结的 Contract**）。文中按“板块”编号，用户的“产品交互与演示”对应**第五板块**。开工前通读全文，下面是摘要：
- **结论三档**：通过 / 需要复核 / 阻止。与 PPT 的对应：ALLOW = 通过，REVIEW = 需要复核，BLOCK = 阻止；ERROR（数据不可用、接口超时等）按“需要复核”暂停受影响功能。多条结论按 阻止 > 需要复核 > 通过 聚合，但**要保留全部原因**。
- **按用途分别判断，不要整页置灰**：例如“比较可用 / 执行阻止”。只读比较（L2）和执行模拟计划（L3）是两种资格，界面要分开显示。
- **权限分级**：L0 公开读取、L1 用户资产读取、L2 分析与只读回放比较、L3 执行模拟计划并修改模拟账户、**L4 真实交易永远禁止**。
- **“审批”指用户本人明确确认完整计划**（一次确认整段计划），**首版没有人工审核后台**。所以界面上叫“确认中心 / 计划确认”，不要做成审核员后台。用户点了确认也不能覆盖“阻止”。
- **第五板块要做的界面**：
  - 基础问卷、详细问卷：可中途回退到基础版，已填的保留，未填的标“未知”。
  - 画像整理与确认：分别展示原始回答、模型归纳、系统演示建议；用户可以纠正，确认后才生效。
  - 资料完整度：显示缺哪些项、影响哪些功能，**不能用填写比例当放行依据**。
  - 风险提示与禁用执行：显示触发原因，后端仍然独立校验。
  - 计划摘要与重新确认：方案或依据变了，要清掉旧的“通过”状态，重新确认。
  - 补充资料入口：属于五种复核恢复动作之一，其余四种（更新数据、修正方案、重新确认、核查执行状态）界面要能看出“现在卡在哪一步、找谁恢复”。
- **提示文案直接用规划表里的写法**，例如“可用模拟资金不足。”“卖出数量超过可卖持仓。”“可查看对比，但该方案超出已确认限制。”“风险估计依据不足”“建议依据尚未核实。”（见规划表第 9、10 节）。
- **执行支持范围**：首版只支持固定候选池内的 A 股普通股票、场内 ETF 和现金。用户说的“基金 / ETF”在执行层面以场内 ETF 为准；场外基金可以展示和比较，能否执行要等第一、三板块确认。
- **数据时间要说清**：显示行情时间和用途，不把旧收盘价说成实时；回放和当前建议是两种模式。
- **不编造置信度百分比**；历史结果不是未来上限。

### 0.5 仓库与提交（`AGENTS.md`，加上 PPT 第 08 页）
- 仓库 `Fintechathon-agent/Fintechathon-agent`，只用分支 `codex/kosx-landing-glass`（用户模块分支；PPT 也要求“按模块开发，避免直接改主线”）。不切换、不合入 main，不强推，不改写历史。
- 本地 `F:\人工智能AI 比赛`（外接盘）；路径不存在就说明外接盘未插好，不要新建空项目。
- 每轮：检查 / 测试 → 审查差异 → 只提交本轮文件 → 推送 → 核对本地与远程 SHA → 写进 `implementation-notes.md`。
- 要进入集成时开 Pull Request，写清代码审查要点、截图和测试说明（PPT 要求），不自己合并。
- 需求、Bug、风险、验收项用 GitHub Issues 记录；“为什么这样做、谁负责”记在飞书 Wiki（由用户转发）。
- 永不提交：根目录 `.gitignore`、`learning/`、`output/`、`prototypes/`、`tmp/`、`chenchen/artifacts/`、`chenchen/dist-static/`、`node_modules/`。不新增生产依赖。

### 0.6 用户一直坚持的设计约束
- 视觉沿用现有 KOSX 式黑橙 + 柔边毛玻璃（PPT 的浅蓝白只是汇报材料风格，不要据此改产品界面）。
- 不要：一打开就进工作台；铅笔动画；社群宣传入口或“视觉灵感”等设计讨论；直接展示 JSON 编辑框；重复、无必要的状态横栏。
- 首页天平：手机与网页一致（两卡并排、同一根橙色横梁）；“手机滑轮”方案已被否决。
- 固定示例金额不能变：投资总资产 ¥31,080.00。（店主余额 ¥6,200.00 只在店主页下线前的回归里继续核对。）

---

## 1. 环境与验收命令

```powershell
git branch --show-current          # 必须是 codex/kosx-landing-glass
git status --short
git fetch origin
git ls-remote origin refs/heads/codex/kosx-landing-glass   # 预期 ed9064b…；若更新，先审查他人改动
cd chenchen
npm run check
npm test                           # 46 项业务测试
# 另开终端：$env:PORT='4177'; node server.js
$env:PORT='4177'; npm run smoke
node scripts/liquid-balance-check.cjs
node scripts/coin-toss-check.cjs
node scripts/explore-check.cjs
node scripts/landing-archive-check.cjs
node scripts/workbench-archive-check.cjs
npm run build:static; node scripts/static-check.cjs
node scripts/archive-check.cjs catalog
```
- 三个宽度 1440 / 1024 / 375：无横向溢出、无文字重叠、无控制台错误。
- 团队本机预览：构建后在仓库根目录运行 `node review/serve.cjs` → http://127.0.0.1:4179/
- 公网演示：https://lixjanus526-art.github.io/finance-lab-demo/ ，来自用户个人公开仓库 `lixjanus526-art/finance-lab-demo`。只放 `dist-static` 构建结果，不放源码或私有仓库内容。
- PPT 的“演示版本校验”：**能启动、能导入、能输出、能审批、能留痕**；异常记 Issue。

---

## 2. 已完成（全部已推送，并核对过远程 SHA）

| 提交 | 内容 | 验证 |
|---|---|---|
| `2298826` | 手机首屏两组标题各两行，按钮在文字下方 | 首屏三尺寸 |
| `171842c` | 投资工作台：手稿背景、静态玻璃、步骤导航、唯一信号焦点 | check / 46 test / smoke、三尺寸、catalog |
| `d96adfd` | 店主工作台：缺口突出，账单 / 现金 / 成本纵向步骤 | 两工作台三尺寸流程 |
| `c77807e` | 静态演示构建（原计算代码在浏览器运行，后端源码未改） | 金额与 Node 对照、SHA-256、导出、错误态 |
| `1e512e4` | 调查“收益与回撤相同”：由数据路径造成，不是公式错误；未改公式 | `docs/investigation-return-vs-drawdown.md` |
| `0349012` | 静态入口 favicon 404 修复 | 静态三尺寸 |
| `f3ea750` | 功能区标题安静区、液体降权、微波动、手机常驻提示 | 全套 |
| `be9bdde` | 硬币四来回循环；液体按真实时间回落；倾斜容器上抬不压字；`review/serve.cjs` 与交接文档 | 全套 + 降帧探针 |
| `6938088` | 手机天平两卡并排，与网页一致；数字随卡宽缩放（安卓无 Consolas 时曾被容器压住） | 全套 + 宽字体断言 |
| `ed9064b` | 橙色横梁（渐变、光晕、挂点、橙色支点）；横梁摆角按长度缩放，两端最多移动 12px | 全套 |

以上都只改了用户模块（`versions/`、UI 检查脚本、静态构建、文档）。详细过程见 `implementation-notes.md` 末尾几节与 `review/overnight-2026-10-07.html`。

---

## 3. 未完成 / 待推进（按用户模块的职责改写）

用户模块的验收标准是 **“Recommendation、Risk、Approval 可展示并回传”**。组长对这一轮的验收标准是 **“用 demo、代码或逻辑架构图做可视化产出”**。

### P0-A 三类关键界面（PPT 第 10 页：用少量界面证明主链路已闭环）
| 界面 | 要展示的 | 现状 | 缺口 |
|---|---|---|---|
| 01 入口 / 导入 | 首页导航、持仓导入（CSV / 手动）、风险偏好、启动检测 | 有展示首页、风险偏好（演示偏好一键填入）、启动健康检查；组合导入接口已有，JSON 编辑框按用户要求隐藏 | 没有 CSV / 手动录入界面；没有“禁投行业”约束输入 |
| 02 风险报告 | 分析总览、Health Score、风险标签、证据链、A / B / C 模拟方案 | 有诊断结果、A / B / C 对照、证据步骤 | 后端诊断报告（`diagnosePortfolio`）**没有 Health Score 字段**，只有 metrics、concentration（HHI、top_1、top_3）、相关性矩阵、hidden_clusters 和 `attention_points`（可当风险标签）。Health Score 要写需求请 Owner 提供，**前端不自己算分** |
| 03 审批与日志 | 计划确认（用户本人确认完整计划，首版无人工审核后台）、Risk State（通过 / 需要复核 / 阻止，对应 ALLOW / REVIEW / BLOCK）、Audit Log、Paper Trading 结果 | 后端任务停在 `HANDOFF_REQUIRED`（交给 Safety）；`/api/audit/:task_id` 可读事件；交易接口 503 | **整页缺失**。这是这一轮最该补的 |

截图标准（PPT）：每张截图回答一个明确问题——能否导入？风险依据是否可见？用户是否审批？日志是否可追溯？不放无法解释的半成品页面。

### P0-B 组长新要求 → 用户模块的交付方式
**理财操作（产品推荐与对比、风险评估、一键申购 / 赎回）：**
- 推荐与对比：范围是**股票、基金 / ETF**（银行理财为后续扩展，本轮不做）。界面按“股票 / 基金·ETF”两类展示和对比（持仓构成、候选调整、证据），用 A / B / C 候选方案承载调整建议，每条建议必须挂证据（红线：不无依据荐股）。推荐逻辑归工具 / 策略侧，UI 只展示。演示数据 `data/demo-portfolio.json` 已有 `type` 字段：`A_SHARE`（股票，目前 1 只：Alpha Holdings）、`ETF`（基金，目前 3 只：Growth / Consumer / Bond ETF）。界面按这个字段分组；需要更多股票或基金样例、场外基金类型时写进需求提案，**不在前端自造数据或硬编码分类**。
- 风险评估：入口处的风险偏好 + 每个方案的 Risk State 标签。状态与阈值以潘心恬的规则为准；规则进仓库之前，UI 只放占位，**不自己编规则冒充团队规则**。
- 一键申购 / 赎回：按钮语义是“生成计划并请你确认”，不是“成交”。流程：生成计划 → 风控检查（通过 / 需要复核 / 阻止，阻止不能被确认覆盖）→ 展示完整计划摘要 → 用户本人确认（L3）→ Paper Trade（模拟）结果 → Audit Log。网关没接入时停在“待确认 / 模拟”，**界面不能出现“申购成功”之类的真实成交字样**。

**五项安全机制（实现优先级：高）的可视化：** 用户模块负责“看得见、能回传”，机制本身归各 Owner。

| 机制 | 机制 Owner（按 PPT 推断） | 用户模块要做的可视化 |
|---|---|---|
| 幻觉防护 | 陈金宝（LLM 编排）+ 金怡含（数据事实） | 每个数字标注来源：计算 / 规则 / LLM 解释 / 人工确认（对应“Code calculates. Rules constrain. LLM interprets. Human approves.”）；交易结果只展示 Paper Trade 返回的回执 |
| 注入防御 | 潘心恬（权限分级、拦截）+ 陈金宝（Prompt / Context） | 用户输入一律按文本渲染；BLOCK 时显示拦截原因；UI 测试：恶意文本不改变界面上的状态 |
| 操作审计 | 潘心恬（日志完整）+ 邹昕成（字段协议） | Audit Log 时间线：输入 → Tool Result → 风险状态 → 候选方案 → 审批动作 → 时间戳，可展开、可导出 |
| 异常熔断 | 潘心恬 | ERROR / 熔断 / 安全锁定的明确界面状态和恢复说明（只在相关位置出现，不做全站重复横栏） |
| 沙箱环境 | 陈金宝 / 邹昕成 | 不属于 UI。逻辑架构图里画出隔离边界即可 |

**这一轮建议交付（不碰 Contract 即可完成）：**
1. `docs/finance-ops/ui-architecture.md`：Golden Path 六步与三类界面、五项机制的可视化映射；用 Mermaid 画数据从各模块到界面的流向，标注每个字段归谁。
2. 计划确认与审计日志界面原型：先做成独立 HTML（例如 `chenchen/docs/finance-ops/confirm-center.html`），内联样例数据，**明确标注“样例数据 / 待接 Contract”**，覆盖 通过 / 需要复核 / 阻止 三档（含“比较可用 / 执行阻止”的分用途显示）和服务异常，以及待确认、已确认、已撤回、模拟成交。风格沿用工作台黑橙玻璃。
3. `docs/contract-proposals/2026-10-08-ui-needs.md`：列出 UI 需要但后端还没有的字段（Risk State、拦截原因、审批动作、Paper Trade 回执、Health Score、风险标签），附样例 JSON，请邹昕成 / 潘心恬 / 金怡含确认。
4. 以上都附截图，开 PR 时写清截图和测试说明。

### P0-C 下线店主财务助手（用户已决定）
- 只在**用户模块**里下线入口：首页功能区第 02 张卡（`versions/landing.html` 的 `merchant-feature`）、产品导航页的店主选项（`versions/home.html`）、工作台侧栏的“店主财务助手”链接（`versions/investment.html` 等）、静态演示构建里的店主页面（`scripts/build-static.cjs`）。
- **不动**：`chenchen/merchant/`、`server.js` 里的 `/merchant` 路由与 `/api/merchant/*`、`tests/merchant.test.js`（属后端 / 其他 Owner）。代码保留在仓库里，只是演示里不再出现入口。是否删除后端代码由对应 Owner 决定。
- UI 检查脚本（`workbench-archive-check`、`static-check`、`landing-archive-check`、`smoke` 等）里关于店主页的断言，相应改为“店主入口不出现”。`tests/` 下的业务测试如果因为入口变化而失败，**先报告用户**，不要自己改别人的测试。
- **首页天平需要设计决定**：天平和硬币循环都依赖两张卡。下线店主卡后，第 02 张卡放什么要让用户选。Codex 先做 2–3 个可点开对比的 HTML 方向原型，**用户选定前不改正式首页**。建议方向：
  - A「股票 ⇄ 基金 / ETF」：01 股票、02 基金 / ETF，天平比较两类资产（贴合用户定的投资范围）。
  - B「风险 ⇄ 审批」：01 风险报告、02 审批与日志，天平表达“风险越重，越需要人工把关”（贴合 Golden Path 后半段）。
  - C 单卡：只保留一张投资卡，天平移到卡内，两侧为“收益 / 风险”（改动最大，硬币循环要重做）。
- 产品导航页（“双场景体验”）也会只剩一个产品，跟着上面的方向一起改，同样等用户确认。

### 截止前排期（本周日 2026-10-11 20:00 前）
| 时间 | 交付 |
|---|---|
| 周四 10/8 | 本清单入库并追加 `AGENTS.md` 段落；`docs/finance-ops/ui-architecture.md`（含 Mermaid 架构图）；`docs/contract-proposals/2026-10-08-ui-needs.md`；首页第 02 张卡的 A / B / C 方向原型，请用户选 |
| 周五 10/9 | 计划确认与审计日志原型（通过 / 需要复核 / 阻止 + 服务异常；待确认 / 已确认 / 已撤回 / 模拟成交）；股票 / 基金·ETF 推荐与对比视图原型；双问卷与画像确认原型（按规划表第 4 节） |
| 周六 10/10 | 按用户选择改正式首页并下线店主入口；若 Owner 已确认 Contract，把原型接入投资工作台，否则保持独立原型并标注“待接 Contract”；全套回归 |
| 周日 10/11 | 截图（每张回答一个问题）、录屏和 Demo Story；开 PR（截图 + 测试说明）；同步公网演示；**20:00 前**交给用户 |

每天 21:00 团队同步前，给用户写好“昨天完成 / 今天交付 / 阻塞风险”三行。

### P1 视觉与演示遗留
- 安卓微信真机复验 `ed9064b`（两卡并排、数字不被压、橙色横梁、硬币循环）；访问加 `?v=<sha>` 避开缓存。
- Firefox / WebKit 未覆盖（用户不下载），保持记为“未覆盖”。
- 旧样式清理：禁用两份旧样式会改动投资页 13 个、店主页 63 个受测节点，不做。
- Demo Story：配合答辩，准备“导入 → 风险报告 → 审批 → 日志”一条演示脚本，配截图和录屏（PPT 下一步：补齐产品截图与录屏）。

### P2 流程性
- 每日 21:00 团队同步，每人 3 分钟：昨天完成 / 今天交付 / 阻塞风险。Codex 每轮结束时给用户写好这三行。
- PPT、截图、演示视频、讲稿、报名材料要保持同一口径。界面改了，要提醒用户同步截图。
- 每次推送后按需同步公网演示：`npm run build:static`，把 `dist-static/` 内容覆盖到 `finance-lab-demo` 仓库根目录（保留 `README.md`、`.nojekyll`），提交推送，约 1 分钟后核对线上文件。
- 用户偏好：重要变更后要有“变更说明 + 小测验”；计划和设计尽量用可视化（HTML / 图）呈现。

---

## 4. 已知坑
- Windows 工作区是 CRLF，补丁是 LF：`git apply` 失败先检查换行。
- 检查脚本用 `channel:'chrome'`；没有 Chrome 的环境换自带 Chromium，**不要改脚本本身**。
- 辅助脚本不要命名为 `*-test.cjs` / `*.test.js`，否则会被 `node --test` 收进去。
- 液体相关断言依赖真实时间；浏览器检查不要并行跑。
- 安卓没有 Consolas，回退字体更宽；改首页排版要跑 `liquid-balance-check`（含宽字体断言）。
- GitHub Pages 和微信都会缓存：验证线上加 `?v=<sha>`。
- GitHub Desktop 提交时逐个勾选，只勾本轮文件。

---

## 5. 问题状态

| # | 问题 | 结论 |
|---|---|---|
| 1 | 各 Contract 的 Owner、Wiki | **已答**（PPT）：见 0.1、0.2。Wiki 用飞书 Wiki / Project Space（链接未给）。Audit Log 的确认人是推断 |
| 2 | Golden Path 是什么 | **已答**（PPT）：见 0.3，投资 Health Check 六步主链路 |
| 3 | 截止日期 | **已答**（用户）：本周日 2026-10-11 20:00 前 |
| 4 | 理财产品范围 | **已答**（用户）：当前覆盖股票、基金 / ETF；银行理财产品作为后续扩展，本轮不做 |
| 5 | 风险规则 | **部分已答**：状态为 ALLOW / REVIEW / BLOCK / ERROR（见 0.4）；潘心恬的 5–10 条具体规则格式和位置未知，规则进仓库前 UI 只放占位 |
| 6 | 申购 / 赎回 | **已答**（PPT）：只做模拟（Paper Trade），必须经过风控和人工审批 |
| 7 | 店主财务助手 | **已答**（用户）：不保留，见 P0-C |
| 8 | 后端代码归属 | **已答**（用户）：暂时不归用户负责 → 只读 |
| 9 | 优先级 | **已答**（用户）：用户负责的产品交互与演示部分，在用户这边优先级最高 |
| 10 | 首页第 02 张卡换成什么 | **待用户选**：Codex 先出 A / B / C 原型（见 P0-C） |

## 6. 建议的第一步
1. 读：`AGENTS.md` → 本文件 → `docs/safety-risk-eval/权限风控规划表-v0.2.md` → `chenchen/README.md` → `implementation-notes.md` 末节。
2. 把本文件放进 `review/`，把附录段落追加到 `AGENTS.md`，检查后提交推送（纯文档）。
3. `git fetch`，只读查看远程各分支有没有队友提交的 Contract、Schema 或规则文件，向用户报告。
4. 按“截止前排期”的周四一行开工：架构文档、需求提案、首页第 02 张卡的方向原型。原型做好后请用户选。
5. 每完成一项：检查 → 提交 → 推送 → 核对 SHA → 写进 `implementation-notes.md` → 给用户写好当天 21:00 同步的三行。

---

## 附：建议追加到根目录 `AGENTS.md` 的段落

```markdown
## 团队分工与公共 Contract（必须遵守）

- 本仓库用户负责“产品交互与演示”模块：Web UI、状态可视化、证据展示、Demo Story；不负责后端业务逻辑。
- 可以直接修改：chenchen/versions/、UI 检查脚本、静态演示构建、review/、screenshots/、文档。
- chenchen/core、chenchen/tools、chenchen/merchant、chenchen/data、server.js 的 /api 逻辑、docs/safety-risk-eval 属于其他 Owner，只读。
- Golden Path、API / Shared Schema、Risk 状态、Approval Logic、Audit Log、核心数据结构的变更，必须先在群里或飞书 Wiki 留记录，由对应 Owner 确认后再 merge；不得私改或口头约定后直接改。
- 需要后端新字段或接口：在 docs/contract-proposals/ 写提案并提交，停下等用户确认。不在后端自行添加，不在前端伪造。
- 红线：不接真实资金；不无依据荐股；不绕过审批；核心指标不由 LLM 编造；没有回执只能显示“模拟 / 待确认”；“审批”指用户本人确认完整计划，首版没有人工审核后台。
- 店主财务助手不保留在比赛演示中（入口下线见清单 P0-C），不再扩展；本轮截止：2026-10-11 20:00 前。
- 进度与待办见 review/CODEX-NEXT-2026-10-08.md。
```
