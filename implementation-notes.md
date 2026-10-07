# 方向 A 正式页面实施计划

状态：**2026-10-07 提交 1（标题安静区 / 天平降权）验收失败，已停止；提交 2 硬币循环未开始。**

## 1. 范围与已核对基线

- 目标分支：`codex/kosx-landing-glass`；不切换、不修改、不合入 `main`。
- 2026-10-06 已检查工作区、远程并执行 fetch。当前 HEAD 与远程目标分支一致：`6be3c892b7d3aae2b1e4f133ff1c9db49f5f37a8`。远程 main 有独立更新，本任务不引入。
- 正式代码目录是 `chenchen/versions/`，下文 `versions/` 均指此目录。参考为根目录 `prototypes/` 中的 A 方向；原型尚未提交，不将其视为已完成全部测试的实现。
- 保留现有未跟踪的 `.gitignore`、`learning/`、`output/`、`prototypes/`，不顺带修改或提交。
- 只改 `/`、`/investment`、`/merchant` 的表现层。保留计算、接口、请求参数、数据源、金额口径、校验、业务状态与导出功能。
- 首页目前独立加载 `landing.css`；两个工作台均依次加载 `style.css → product-overrides.css → kosx.css → glass.css`。玻璃样式广泛命中嵌套卡片、导航与弹窗，是此次收敛重点。
- `/catalog` 也依赖旧共享样式：须做回归检查，不能为精简目标页面样式而破坏目录页。`presentation.mjs`、`ui-model.mjs` 及后端计算文件保持不变。

## 最新阶段划分（覆盖下文旧的样式合并顺序）

1. `refactor(ui): add design tokens and archive scene scaffolding`：仅新增 tokens.css / archive.js，引入三页并扩充静态白名单；不改变现有 CSS，archive.js 只导出构造函数、不挂载。四页三尺寸与原基线一致，check / test / smoke 全通过再提交推送。
2. `feat(ui): archive-glass landing with orange metal K and coin`：首页改版，人工逐组件替换旧规则。使用新版视觉验收，不比对旧首页；/catalog 仍严格比对原基线。
3. `feat(ui): archive-glass workbenches with step navigation and signal focus`：两个工作台改版，完整流程和新版视觉验收；/catalog 仍保持不变。
4. 可选 `refactor(ui): unlink legacy kosx and product-overrides from workbenches`：仅在阶段 ③ 后确认不再依赖才移除引用，以阶段 ③ 为新基线；可跳过但必须说明。

禁止 CSSOM 自动去重。各阶段均完整运行 check / test / smoke 和对应三尺寸检查；任一步失败，记录 Deviations，停在该阶段且不提交失败改动。阶段 ② / ③ 的失败改动保留为明确未通过的本地草稿，避免丢失诊断证据；不视为交付。

## 2. 设计令牌与样式归属

新增 `versions/tokens.css`，统一维护以下值；数值为实施起点，最终以对比度与三尺寸验收为准。

| 类别 | 令牌与拟定值 | 约束 |
| --- | --- | --- |
| 暖黑底色 | `--canvas: #0b0a09`、`--archive-surface: #191715`、`--decor-ink: #b8ada0` | 装饰线以暖灰透明度分层，不使用墨绿灰 |
| 正文 | `--text-primary: #f3eee8`、`--text-secondary: #c9c0b6`、`--text-on-signal: #17100a` | 正文、辅助说明、按钮文字均检查 4.5:1；透明表面按实际背衬检查 |
| 品牌橙 | `--brand-orange: #ed7627`，配套高光 `#ffe2ac`、暗部 `#71300e` | 只在 tokens 的首页作用域 `.landing-page` 声明；供首页 K、硬币、原创字标使用 SVG 渐变，不作纯色大块 |
| 信号橙 | `--signal-orange: #ff914a` | 小面积纯色，用于当前唯一焦点；工作台没有品牌橙定义、引用或隐式继承 |
| 字号 | `--text-body: 16px`、`--text-title: clamp(24px, 2.4vw, 34px)`、`--text-display: clamp(36px, 4.5vw, 64px)` | 内容层三档字号；另设 `--text-meta: 13px` 等宽元信息档，用于编号 / 类别，满足 4.5:1 且不承载操作必需信息 |
| 圆角 | `--radius-panel: 18px`、`--radius-control: 8px` | 控件和纸页装饰不沿用大卡片圆角 |
| 玻璃 | `--glass-tint: rgb(25 23 21 / 76%)`、`--glass-blur: 18px`、`--glass-border: rgb(232 216 195 / 18%)` | 毛边来自柔和边光与细线，正文下方有稳定暗色承托 |
| 动效 | `--motion-duration: 320ms`、`--motion-ease: cubic-bezier(.22,1,.36,1)`、`--motion-distance: 12px`、`--ambient-duration: 70s` | 数字、入场、展开和反馈共用 320ms；背景慢动独立；滚动叙事直接跟随滚动进度 |

样式加载收敛为：首页 `tokens.css → glass.css → landing.css`；工作台 `tokens.css → style.css → glass.css`。不新增 override 文件。

- `tokens.css` 只管理设计值；`style.css` 管控件、工作台布局与响应式；`glass.css` 管复用手稿、玻璃表面及共享动效；`landing.css` 只保留首页构图与叙事样式。
- 把 `product-overrides.css`、`kosx.css` 中目标页面需要的规则归并到上述唯一归属位置，再删除目标页面的旧样式引用。清理已迁移且不再被使用的规则、重复媒体查询和全局橙色按钮规则，不以文件尾追加覆盖完成迁移。
- 旧文件中仍被 `/catalog` 或其他现存页面使用的规则保留；工作台新布局规则使用页面作用域，避免影响旧页面。这是明确的兼容边界，不为本任务重做目录页。
- `common.js` 当前通过 `--product-shell` / `--kosx-shell` 判断资源是否加载；随样式迁移更新目标页面的检测标记，同时保留目录页兼容检测，避免误报部署错误。

## 3. 可复用手稿背景与玻璃预算

新增纯表现层模块 `versions/archive.js`，使用原生 SVG / DOM 创建同一套 `.archive-scene` 装饰；三个页面调用同一构造函数，通过页面属性选择密度，不复制三份背景代码。

- 保留 A 的账本格线、两张倾斜档案纸、刻度尺、`062 / XL / 26` 等宽编号、原创 LAB 印章。背景统一 `aria-hidden="true"`、`pointer-events: none`，不承载说明、状态或按钮。
- 首页维持 A 的层次和密度；工作台装饰组数量约减半，并降低局部对比。卡片边缘用非交互 SVG 细批注线、坐标、小印章、页码；与内容保留至少 16px 安全距离。
- 在主卡片后方实际摆放纸页边缘、编号和印章，而不只把纹理放在页面两侧。有限幅度的慢漂移与滚动视差让玻璃后面的内容可辨；同一个 rAF 调度器只更新变换，不逐帧读写整页布局。
- 仅一级内容板允许 `backdrop-filter`；内嵌指标、方案、账单行使用半透明底与细边，不再次模糊。导航、吸顶步骤条使用实色背衬。
- 采用静态分配，禁止随滚动开关模糊：首页两个功能板；投资页余额、分布、输入、方案差异、方案区共 5 块；店主页余额、缺口、账单、现金、成本共 5 块，弹窗作为第 6 块。其余面板固定使用实色或普通半透明底；弹窗遮罩只变暗。用测试逐状态计数同屏不超过 6 块。
- 玻璃属性不做动画；背景离屏和页面隐藏时暂停慢动。不支持 backdrop-filter 时使用暖黑实色回退。
- 余额旁的原型小柱图没有时间序列依据，改为等间距、等长度的尺规刻度，并设为装饰；不编造“近 7 日余额”。正式金额仍来自现有 API。

## 4. 唯一信号橙焦点

品牌橙与信号橙分工；首页的金属图形不占用信号焦点，但同屏只允许一个信号橙主按钮。工作台的字标、产品切换、图例、辅助操作、普通日期和卡片边线全部中性化。键盘焦点使用高对比中性描边，不再制造额外橙点。

| 页面 / 状态 | 唯一信号橙焦点 | 其他内容 |
| --- | --- | --- |
| 首页 K / 硬币段 | 一个进入功能区的主按钮 | 标题、进度线、导航中性；金属 K / 硬币及首页字标可使用品牌橙 |
| 首页两功能入口 | 当前 hover / 键盘聚焦的一个入口；无交互时不强行标橙 | 另一个入口中性；叙事按钮离屏后退出焦点分配 |
| 投资页未生成结果 | “开始健康检查”主按钮 | 当前步骤以中性粗体与下划线高亮；不制造方案判断 |
| 投资页结果段 | 已有“方案差异”结论或当前真实错误 / 风险提示 | 不把任一方案卡标成推荐；原判定与文案口径不变；其他方案与按钮中性 |
| 店主页概览 | 已有“首个缺口”的日期 / 负余额，作为同一个风险焦点区域 | 已核对余额和辅助指标降为中性，缺口卡依靠面积、留白和字重取得明显优势 |
| 工作台风险焦点离屏 | 视口内有明确主操作时给主操作，否则给当前步骤 | 步骤随阅读位置移动；风险回到视口时步骤改用中性粗体、下划线与 `aria-current` 保持定位 |
| 当前任务错误 / 账单弹窗 | 优先显示当前阻断错误；无错误时弹窗内唯一主要动作可承接信号 | 底层页面暂时转为中性；关闭后恢复原来焦点 |

明确优先级：当前阻断错误 / 模态主要动作 → 视口内核心风险或方案差异 → 明确主操作 → 当前步骤。明确主操作优先于步骤指示；投资未生成结果时主操作为开始健康检查，生成后转为方案差异。任何时刻只能有一个信号焦点区域；同一区域可同时有橙色日期与负余额。步骤“高亮”不等于必须同时橙色，避免与已可见的风险争抢。正常无缺口时不伪造警示，以当前步骤承接信号。

## 5. 首页滚动段

- 保留原生滚动与现有 K 右侧两笔顺时针形变：先成为左侧大硬币，再右移缩小；反向滚动使用同一确定性进度函数，回到顶端完整恢复 K。
- 移植 A 的标题互斥时间段：0–18% 旧标题淡出，18–31% 无标题，31–48% 新标题进入。说明文字随所属标题成组变化；透明为零后同时不可见并退出辅助阅读。测试正反滚动和快速跳滚，不靠动画延迟碰巧错开。
- K 与硬币采用原创 SVG 橙色金属渐变、高光和暗部；两条标题与 K 在桌面左右分区、手机上下分区，禁止压字。
- 将画面内滚动角度与硬币绕竖轴翻转角度分开。¥ 使用独立正反面图层，不跟随非等比挤压变形；背面方向校正，两个面均设背面隐藏。
- 当绕竖轴角度归一化后处于 60°–120° 或 240°–300°，¥ 完全隐藏，只保留边缘齿纹。其余角度面符号保持原字形比例；测试覆盖边界、90°、180°、270°和连续采样。
- reduced-motion 下取消 K 旋转、翻转、视差和长距离运动；保留静态金属 K、可访问的功能入口与互斥淡入文案，不让用户必须观看动效才能进入页面。

## 6. 工作台定位、入场与数据呈现

### 步骤对应区块

| 页面 | 步骤 | 实际内容位置 |
| --- | --- | --- |
| 投资 | 01 确认偏好 | 现有 `#input-panel`，点击时打开折叠偏好区 |
| 投资 | 02 诊断与模拟 | 未分析时 `#analysis-anchor`；结果就绪后 `#result-summary` 与方案区 |
| 投资 | 03 查看依据 | 为现有“任务状态与工具证据”面板补稳定锚点 `#evidence-panel` |
| 店主 | 第一步 看懂账单 | `#ledger-panel` |
| 店主 | 第二步 现金安排 | `#cash-panel` |
| 店主 | 第三步 成本解释 | `#cost-panel` |

- 将投资页的静态 `.journey-strip` 改成可点击的锚点导航，店主页增加同组件；不增加第二套重复状态横栏。吸顶偏移取实际页头与导航高度，目标区设置 scroll-margin，避免标题被遮住。
- 点击后平滑滚动并同步当前步骤；手动滚动、上滚、窗口缩放、展开方案后均重新判断阅读区间。采用步骤起点与页尾规则决定活动项，避免高矮不同的面板造成闪烁或最后一步无法激活。
- 投资结果未产生时，第 03 步明确不可用并说明“完成健康检查后查看”，不得跳到隐藏证据或自动发请求。生成结果后启用；偏好改变导致结果失效时恢复不可用。原业务状态仍由现有脚本负责。
- 店主页当前现金与成本区并排；为使 02 / 03 对应顺序明确，改为纵向的两个区块，各区块内部仍可桌面分栏。提醒区域归在最后一步的后续操作，不虚构第四步。
- 卡片进入视口 10% 即开始，位移 12px、时长 320ms，避免按整段高度触发或串行等待。大面板不整块隐藏；默认正文可见，JS 只增强小范围入场，脚本失败也不留白。
- 数字动效只装饰已有格式化结果；不改变任何输入、金额运算与 API 返回值。辅助技术直接读取最终数字；更新中断、切页或 reduced-motion 时立即恢复准确最终值，不停在中间金额。
- 方案展开、数据出现、生成提醒的呈现共享动效令牌；业务成功、失败反馈仍取真实请求结果，不用定时器模拟业务完成。
- 首次加载使用有固定尺寸的账页格线骨架，保留短的屏幕阅读器状态与 `aria-busy`。清理可见的“正在读取…”碎片，加载失败转为完整错误和现有重试入口，不掩盖错误。

## 7. 预计改动文件

| 文件 | 最可能的改动 |
| --- | --- |
| `implementation-notes.md` | 本计划、实施偏差、验证结果、变更摘要与已知问题 |
| `chenchen/versions/tokens.css`（新增） | 统一颜色、四档字号、圆角、玻璃与动效；品牌橙仅首页作用域 |
| `chenchen/versions/archive.js`（新增） | 共享背景构造、受限视差、入场、数字呈现、步骤定位与信号优先级；不包含计算或请求 |
| `chenchen/versions/glass.css` | 归并手稿与玻璃组件，收紧模糊作用范围、降级和可访问性 |
| `chenchen/versions/style.css` | 工作台样式归并、层级、网格、吸顶步骤、骨架、移动端与焦点状态 |
| `chenchen/versions/kosx.css`、`chenchen/versions/product-overrides.css` | 清理目标页面迁出的无用规则，保留其他页面仍使用的样式；不再被两个工作台加载 |
| `chenchen/versions/landing.html`、`landing.css`、`landing.js` | 令牌 / 组件接入、金属 K 与硬币、标题互斥、侧面符号处理、反向还原 |
| `chenchen/versions/investment.html`、`merchant.html` | 新样式入口、步骤锚点、数据板层级、骨架、工作台中性字标与背景挂载 |
| `chenchen/versions/investment.js`、`merchant.js` | 仅调整渲染标记、展示颜色与视觉生命周期接入；不变更分支判定、计算、请求或业务状态流转 |
| `chenchen/versions/common.js` | 更新样式加载检测；共用图表使用中性色与线型区分，维持标签和数值，不修改 api / chartDomain / money 等逻辑 |
| `chenchen/server.js` | **仅静态资源白名单**增加 tokens.css / archive.js；不改页面路由、接口与服务器业务逻辑 |
| `chenchen/scripts/ui-check.cjs` | 更新视觉选择器并补齐尺寸、滚动、动效、核心流程与信号检查 |
| `screenshots/`（仓库根目录，新增） | 正式页面 12 张验收图及检查结果；不混用原型截图 |

实施前建立计算模块与接口文件基线；差异审查确认无业务改动。若确需新增上述范围外的文件，先在 Deviations 记录原因与保守处理方式；超出纯表现层授权的改动不实施。

## 8. 实施顺序与验证门槛（确认后执行）

1. 保存现有正式页截图及接口 / 核心流程基线，运行现有检查与测试，区分既存失败；保留当前提交作为回退点。
2. 先归并令牌与共享手稿 / 玻璃组件，移除目标页面旧样式引用，核查 `/catalog` 和现有辅助页面没有意外变化。
3. 完成首页金属材质、标题互斥、角度门控与反向滚动；再接入两个工作台的卡片层级、步骤导航和骨架。
4. 接入统一数据与反馈动效、唯一信号状态；检查弱网、失败重试、折叠区、弹窗、长文字和空数据状态。
5. 执行项目 `check`、`test`、`smoke` 和 UI 回归；基于已有 Playwright / axe，不引入新框架或生产依赖。业务测试结果和最终金额须与基线一致。
6. 三页分别以 1440、1024、375 宽度检查：无横向溢出、标题 / 按钮无遮挡、无控制台与页面脚本错误；桌面和手机验证键盘操作与焦点可见。
7. 完整操作投资“填入演示偏好 → 开始健康检查 → 展开方案细节”；店主“打开账单 → 勾选已看懂 → 生成提醒”。同时检查失败重试与投资输入更改后的结果失效表现没有退化。
8. 自动采样正反向滚动，断言每时刻至多一组标题可见，留空段确实两组均不可见；从末端回顶完整恢复 K。连续采样硬币翻转，侧面门控区没有 ¥，正反面无镜像或变形。
9. 静态检索工作台模板、脚本、专属样式无 `var(--brand-orange)`；浏览器检查工作台计算样式的品牌令牌为空。允许共享 tokens.css 内存在**仅匹配首页**的声明。检查图表、字标、按钮和当前步骤无多余橙色焦点。
10. 每个关键滚动位置及弹窗状态统计可见 backdrop-filter 元素 ≤6；检查 reduced-motion、无模糊支持和无 JS 的阅读 / 首页入口回退。axe 加实际背景对比度检查正文及信号按钮 ≥4.5:1。
11. 输出截图并逐张人工检查：`screenshots/landing-hero-desktop.png`、`landing-transition-desktop.png`、`investment-data-desktop.png`、`merchant-data-desktop.png`，以及相同名称的 `-mobile.png`，并增加 `coin-edge-desktop.png` / `coin-edge-mobile.png`（竖轴约 90°）及 `investment-result-desktop.png` / `investment-result-mobile.png`（健康检查完成后），共 12 张。桌面用 1440，手机用 375；1024 另外记录检查结果。
12. 在本文件末尾写实际变更摘要、测试结果和已知问题，审查所有差异、暂存文件与敏感信息。按下列三次提交分阶段执行；每次均完整运行 check / test / smoke 与对应页面的 1440 / 1024 / 375 检查，通过后才提交并推送：
    - ① `refactor(ui): consolidate tokens and stylesheet layers`：视觉基本不变；检查三页与 /catalog，重点保留目录页。
    - ② `feat(ui): archive-glass landing with orange metal K and coin`：首页背景、金属形变与标题；检查首页三尺寸。
    - ③ `feat(ui): archive-glass workbenches with step navigation and signal focus`：两个工作台与完整核心流程；检查工作台三尺寸及最终整体验收。
    - 任一步失败，记录到 Deviations 并停在该步，不提交不通过的改动、不继续下一步。
13. 只推送 `codex/kosx-landing-glass`，核对本地与远程提交编号一致；不合入 main。若远程有协作者更新，先保留并处理冲突、重测，禁止强推。最终报告真实同步结果、改动文件与截图路径。

## Deviations

### 2026-10-07 · 功能区优化提交 1 停止记录

- 开工已 pull --ff-only，基线为 2298826，工作区原有未跟踪文件完整保留。补跑 check、46/46 test、smoke 均通过，记录见本文件后文和 artifacts/archive/2026-10-07-baseline.json。
- 本地草稿包含：标题暖黑磨砂面板及背后半透明安静区；液体空闲 opacity .6、活动 200ms 恢复 / 1.2s 降权；0.6px / 3.6s 水面呼吸；hover:none 双语常驻提示。手机首屏标题和 CTA 规则未修改。
- **失败门槛：**scripts/explore-check.cjs 首个 1440px 场景中，点击后等待 250ms，断言 interaction restores brightness 失败；期望 opacity = 1，实际为 0.966596。首次激活依赖下一帧才写入 data-liquid-active，活动态同步与 CSS 过渡起点需后续恢复时核查；当前尚未确认唯一根因。
- 已立即停止实现，不以放宽断言作为通过，不推进硬币循环，不提交 / 推送此次草稿。新功能三尺寸、截图与完整验收未完成。
- 失败测试脚本保留在 chenchen/scripts/explore-check.cjs；结构化记录在 chenchen/artifacts/archive/2026-10-07-quiet-failure.json。


### 2026-10-06 · 阶段 ① 停止记录

- 用户的五项修订已更新：主操作优先、三次独立提交、静态玻璃预算、13px 等宽元信息、12 张最终截图。
- 阶段 ① 尝试归并三层 CSS，并通过 CSSOM 去除相同选择器中被覆盖的属性；为减少兼容层，也尝试让 /catalog 与 404 页使用统一入口。该扩大到辅助页面的改动只涉及样式引用，现已一起撤回。
- **失败门槛：**新增浏览器对比在 1440 宽投资页发现计算样式 / 几何变化：页面高度由 1215.78px 变为 1217.78px，部分按钮尺寸变化。首页 1440 对比通过，但这不足以放行本阶段；后续合并版检查停止。
- 初步原因：CSSOM 重写和属性去重不能保证原有简写 / 长属性及中间级联完全等价，不能把这种自动归并当成无视觉变更。后续如恢复本阶段，应逐组件人工整理，并以旧画面为基准验证，而非放宽误差掩盖变化。
- **保守处理：**仅撤回本轮尝试修改的正式文件，删除本轮新建且未通过验证的 tokens.css；原有未提交文件与 prototypes/ 完整保留。没有继续阶段 ② / ③，没有创建失败提交，也没有推送。
- 新增检查脚本 chenchen/scripts/archive-check.cjs，用于保存原有四页三尺寸基线与逐元素计算样式 / 几何对比；属于预计 UI 测试工作的独立脚本拆分，不改变产品行为。基线截图及快照在 chenchen/artifacts/archive/（本机、Git 忽略）。
- 基线已通过：check、46/46 测试，以及 /、/investment、/merchant、/catalog 的 1440 / 1024 / 375 共 12 组页面检查。恢复后再次完整通过 check、46/46 test、smoke，以及四页三尺寸共 12 组计算样式 / 几何基线比对，确认原页面已恢复。


### 阶段 ② · 新版首页验收停止记录

- 首页组件人工整段替换，未使用 CSSOM 自动去重。原有工作台 CSS 未重写；共享 glass.css 仅增加独立 archive 组件和首页作用域表面，/catalog 基线保持一致。
- 设计实现差异：¥ 采用独立、等比、保持正向的符号层，随翻转角度完全隐藏；不用会产生挤压 / 镜像字形的正反面文字投影。这是保守的纯表现层处理，不改变侧面隐藏要求。
- 检测工具准备时 axe 要求显式 browser.newContext；测试入口已修正为独立上下文后重跑。这是测试调用错误，不是页面视觉问题。
- 新首页 1440 / 1024 两组通过正反向进度采样、标题互斥、边缘符号隐藏、无溢出 / 无脚本及控制台错误、入口链接、玻璃预算、axe WCAG AA 与 reduced-motion 检查。
- **停止原因：375px 的 quiet interval 断言失败。** 请求滚动进度 0.18 实际为 0.1799479317，请求 0.31 实际为 0.3102805901；浏览器将滚动距离取整，测试却使用请求进度决定“必须完全透明”，导致边界断言不成立。不是已证实的双标题重叠；需要在后续恢复本阶段时校正实际进度边界检验，并确认真实留空区间，不能把本次结果标为通过。
- 已按失败停止，不修改此处时间区间来绕过失败，不进入工作台阶段，不提交 / 推送阶段 ②。草稿及测试证据保留本地，等待下一次明确恢复。
- check 通过、46/46 test 通过、smoke 通过；/catalog 1440 / 1024 / 375 与原计算样式及几何一致。375 新版验收尚未完整通过，最终无 JS 检查也尚未执行到。
- 失败证据：screenshots/landing-failure.txt、landing-failure-boundary.json、landing-failure-mobile.png。当前 6 张首页截图仅为阶段 ② 草稿，不是最终 12 张已验收交付图。

## 变更摘要 + 已知问题

### 阶段 ①（修订范围）完成
- 仅新增 tokens.css 与导出 createArchiveScene 的 archive.js，三页引入且不挂载；静态白名单放行。所有原有 CSS 原样保留。
- check 通过，46/46 test 通过，smoke 及两个新增资源 HTTP 检查通过。
- archive-check.cjs consolidation：四页 × 1440 / 1024 / 375 共 12 组计算样式与几何对比完全一致，无横向溢出与控制台错误。
- archive-check.cjs 是前次已建立的基线检查脚本，本阶段一并纳入版本控制。快照仍位于本地 chenchen/artifacts/archive/；在已有基线环境使用 consolidation 模式，重建基线必须明确使用 baseline 模式。
- 后续阶段尚未完成；最终 12 张新版验收截图尚未齐备。原型、learning、output 和根 .gitignore 未纳入提交。

### 当前同步状态与待完成项
- 阶段 ① 提交：efb7e52c748eb18204952cca4044170990796959；已推送 codex/kosx-landing-glass，并用 git ls-remote 核对一致。
- 阶段 ②：本地未提交草稿，停止点如上；阶段 ③ / 可选 ④ 均未启动。
- 12 张最终截图尚未齐全；不能将草稿截图称为验收通过。当前不合入 main，未更改接口或计算逻辑。

## 2026-10-07 · 开工基线与本轮范围

- 已执行 git pull --ff-only origin codex/kosx-landing-glass，返回 Already up to date；起点 2298826，前一提交 a023dfc。旧的阶段 ② 停止记录保留为历史，不代表当前已同步版本的状态。
- 补跑记录：node scripts/check.js 退出 0；node --test 46/46 通过、退出 0；在独立本机服务器上运行 node scripts/smoke.js 退出 0。原始日志保存在 chenchen/artifacts/archive/2026-10-07-baseline.json。
- 本轮仅改首页四个表现文件及测试脚本、本文和验收截图；工作台、glass.css、接口与计算逻辑不修改。
- 提交 1：标题安静区、液体静止 60% / 活动恢复、0.6px / 3.6s 呼吸、hover:none 常驻提示。呼吸是此次新授权，因此可见时静止水面继续共享 rAF，离屏 / 隐藏 / reduced-motion 停止。
- 提交 2：独立硬币在开场后交替落入，01→02→01 为一轮，共 4 轮；手动交互优先，停手 4 秒且回正后续播。不影响首页大硬币。

### 2026-10-07 当前变更摘要与已知问题
- 本轮新内容仅本地：首页 landing.html / landing.css / archive.js、测试及记录。未改工作台、接口、计算逻辑，未切换或合入 main。
- 已知阻断：液体活动亮度未在验收等待窗口内精确到全亮；标题安静区等也尚未完成全部新验收，因此不能称为完成。
- 硬币投掷循环及其三张截图尚未实现；新两次提交均未创建。

### 本次停止时的最终检查记录
- 修改后 check、46/46 test、smoke 均通过（完整日志 chenchen/artifacts/archive/2026-10-07-quiet-validation.json）。
- landing-archive-check 三尺寸通过，手机首屏标题两行 / CTA 位置保持；archive-check catalog 三尺寸与基线一致；liquid-balance-check 三尺寸通过原有注满拒绝、回落平衡、键盘及 reduced-motion 回归。
- 新增 explore-check 未通过：首次 1440 场景的活动亮度恢复断言失败，后续新验收未放行。原有检查通过不替代本次新增门槛。
- 测试重新生成的既有截图也仅保留本地；新要求的五张最终截图尚未齐备。
- HEAD 与 origin/codex/kosx-landing-glass 均仍为 229882613644ae7e27966fdfd7472f426f135c60，本轮无提交和推送。

## 2026-10-07 夜间任务（最新规则）
- 已读取用户粘贴的完整夜间任务；以下覆盖此前失败即整轮停止的安排：每阶段失败撤回该阶段正式改动，记录 Deviations，继续独立阶段；单问题不超过 30 分钟。
- 阶段 0：pull --ff-only 成功，2298826 为远程一致起点，包含手机两行标题修复。上轮草稿先备份到 chenchen/artifacts/overnight/preflight.patch，再恢复正式代码基线。
- 基线：check / 46项 test / smoke / ui-check / landing-archive-check 三尺寸 / catalog 三尺寸对比全通过；日志 chenchen/artifacts/overnight/stage0.json。晨间报告骨架已建立。
- 不修改 prototypes、learning、output、tmp、根 .gitignore；不新增生产依赖；原业务模块保持不变。报告仅陈述实际结果。

### Deviations · 夜间阶段 1
- 点击事件立即同步活动态并缩短淡入至 160ms 后，新验收仍在 250ms 读取 opacity 0.85005，未达到 1。未降低门槛。
- check / 46项 test / smoke 通过；explore-check 首组失败，因此本阶段正式文件及测试变更已撤回。草稿与证据备份至 artifacts/overnight/stage1-failed.patch、stage1.json、explore-check.failed.cjs。
- 标题安静区、液体降权与常驻提示本次未交付。阶段 2 的硬币独立于这些样式，基于已通过的原液体天平继续。

### Deviations · 夜间阶段 2
- 独立硬币试作共用 rAF、9 次落入计 4 个来回；验收中“点击中断”期望 paused、实际 rest。可能涉及自动化点击等待运动控件稳定的时机，但未完成证明，不视为通过。
- check / 46项 test / smoke 通过；coin-toss-check 失败。按阶段失败规则撤回正式脚本、样式及验收脚本；保留 artifacts/overnight/stage2-failed.patch 和 stage2.json。
- 后续工作台及静态构建不依赖新首页动画，继续；本轮首页维持 2298826 已通过版本。

### 夜间阶段 3a · 投资工作台
- 暖黑手稿背景、五块固定玻璃、边缘 LAB 编号；投资分布图和普通按钮中性化。未产生结果时橙色给健康检查，方案差异入屏时交给它；依据步骤在结果生成前不可用。
- 步骤点击定位、手动滚动跟随、结果失效恢复禁用；数字以准确最终文本做 320ms / 12px 入场，辅助技术无中间金额；加载格线骨架取代碎片文字。
- 验收通过：check、46/46 test、smoke；workbench-archive-check investment 1440/1024/375；既有 ui-check 35组；catalog 三尺寸与旧基线一致。日志 artifacts/overnight/stage3a.json；截图 screenshots/investment-{data,result}-{desktop,mobile}.png。
- 保守实施偏差：保留 catalog 使用的旧样式源与工作台旧引用，新组件集中于已有 glass.css 的 archive-workbench 作用域，未新建 override 文件。可选阶段 7 再确认是否可安全取消引用，不做自动 CSSOM 去重。
- 没有修改后端、ui-model、presentation、接口参数或金额算法；common.js 仅为新版工作台选择中性色图表。

### 夜间阶段 3b · 店主工作台
- 投资页提交 171842c1ae032f2cefe5d9addc216a60d3954b08 已推送，git ls-remote 与本地一致。
- 店主复用低密度档案背景，余额 / 缺口 / 账单 / 现金 / 成本固定五块玻璃，弹窗为第六块。缺口大卡取得主要视觉权重；无缺口时不标风险。
- 第一步账单、第二步现金、第三步成本可点击定位并滚动跟随；现金与成本改为纵向；去除重复页头状态横栏。骨架、元信息和中性控件与投资页一致。
- 金额、接口、账单核对门槛未改；确认来源后才生成提醒。check / 46项 test / smoke、两工作台三尺寸完整检查、35组既有UI、catalog旧基线全部通过。日志 artifacts/overnight/stage3b-final.json。
- 截图 screenshots/merchant-data-{desktop,mobile}.png 已检查，工作台无品牌橙，风险 / 弹窗 / 操作按优先级唯一高亮。

### 夜间阶段 4 · 静态演示构建
- 店主页 d96adfd15a9e7cb2fe45f522ebb88ff3fab09b02 已推送并核对远程一致。
- 新增 scripts/build-static.cjs、scripts/static-check.cjs；package.json 增加 build:static / test:static；chenchen/.gitignore 忽略 dist-static；README 说明构建、托管与会话边界。
- 构建包装原 Harness / MemoryStore / financial-tools / MerchantSession / 演示 JSON，直接提取 server.js 的 API 路由与错误响应，不改后端源码。同步 SHA-256 覆盖中文、emoji、块边界与长文本，结果与 node:crypto 一致。
- 验证：check / 46项 test / smoke 全通过；静态站点 1440/1024/375 两流程、¥31,080.00 / ¥6,200.00、模拟输出逐字段一致、账单预测一致、子目录相对路径、导出 JSON、400/404/413/503、无控制台错误和无API网络请求均通过；catalog旧基线不变。日志 artifacts/overnight/stage4.json、artifacts/static/report.json。
- 静态页面不依赖 Node 后端；构建时需要 Node，托管仍需 HTTP(S) 服务，不能直接 file:// 双击模块页面。数据仅当前页面内存，刷新重置；不提供真实账户、跨设备持久化或自动部署。

### 夜间阶段 5 · 收益与回撤调查
- 静态版 c77807e883a689c3e4322d697ce43ee39693a6b4 已推送，远程与本地一致。
- docs/investigation-return-vs-drawdown.md 已完成。不是同字段或同公式错误，也不是严格单边下跌；起点最高、终点最低，令两指标精确相同。实测原函数反例 [1,1.1,0.99,1.05] 得到 +5% / -10%。
- 原始证据 artifacts/overnight/investigation-evidence.json、investigation-counterexample.json；未修改计算逻辑与数据。换窗口 / 泛化公式的影响面与不宜为制造差异改公式的原因已写明。
- 文档阶段仍复跑 check / 46项 test / smoke、投资页三尺寸核心流程检查通过（stage5.json）。

### 夜间阶段 6 / 可选 7
- Firefox 与 WebKit 的 Playwright 可执行文件均不存在；按要求不下载，跨浏览器覆盖记为未覆盖。本机 Chrome 已完成所有已交付阶段检查。
- 只读实验在三尺寸临时禁用 kosx.css / product-overrides.css，投资页 13 个、店主页 63 个受测节点改变。可选阶段 7 的无变化门槛不满足，未改正式引用。证据 artifacts/overnight/browser-availability.json、legacy-dependency.json。

### 首页阶段再次尝试的顺序记录
- 独立阶段 3a / 3b / 4 / 5 已通过并推送后，利用剩余时间恢复首页问题。此前失败记录与撤回动作不变；新的尝试须重新完整验收，失败继续撤回。
- 阶段 1 选择更保守的视觉响应：活动态立即恢复全亮（满足 200ms 内），空闲态仍 1.2s 回落。避免依赖浏览器过渡采样时机；不放宽亮度断言。

### Deviations · 静态入口图标回归修复
- 首页第二次尝试的 explore / liquid / landing 三尺寸检查全部通过，附加 static-check 出现一次 404。按规则暂存补丁并撤回首页未提交代码，先独立修复静态入口。
- 隔离实验将入口跳转延迟 2 秒，稳定复现浏览器请求 /favicon.ico 返回 404；原因是生成的 index.html 没有 icon 声明，与首页液体逻辑无关。
- build-static 为跳转入口显式引用已有 versions/favicon.svg；static-check 延迟入口跳转 1 秒并记录报错 URL，防止偶发漏测。check / 46项 test / smoke / 静态三尺寸流程全部通过（artifacts/overnight/static-icon-final.json）。没有忽略 404 或放宽错误检查。

### 夜间阶段 1 · 恢复后完成
- 外接 F: 盘重新连接后核对原工作区；未建立替代仓库，也未覆盖未提交文件。远程起点仍为 0349012ca2abc48096c1ac2e7e8019750fa55623。
- 上次中断前的 stage1-final.json 已完整落盘：check、46 项 test、smoke、explore / liquid / landing / static 三尺寸及 catalog 旧基线全部通过。本次核对八项退出码均为 0。
- 标题安静区、立即全亮响应、1.2 秒降权、0.6px / 3.6 秒呼吸、手机常驻提示已完成；没有改变容器尺寸、首屏标题和业务逻辑。活动响应采用立即切换，满足 200ms 内恢复，避免采样时序的不稳定。
- 截图：screenshots/explore-quiet-{desktop,mobile}.png；其余首屏 / 侧币 / 液体截图随验收刷新。此前失败历史保留，当前以这次通过结果为准。
