# Finance Lab · Claude 接手续做与验收文件

> **2026-10-07 Claude 接手结果**：硬币四来回循环已完成整套回归并提交到 `codex/kosx-landing-glass`（feat(ui): coin toss loop across the liquid balance）。回落偶发超时已闭环（约 20fps 时旧公式只按 80% 速度回落，用时约 24 秒；改为按真实时间回落后实测 16.8 秒）。详情见 `implementation-notes.md` 末节与 `review/overnight-2026-10-07.html`。公网演示：https://lixjanus526-art.github.io/finance-lab-demo/ 。下文为接手前的交接原文，第 4–6 节所述“未完成”状态已过时。

更新：2026-10-07。用户要求在额度剩余约 10% 时交接，并先向 GitHub 发布队友可检查的稳定成果。

## 1. 先读这一段

- 仓库：https://github.com/Fintechathon-agent/Fintechathon-agent
- **只使用 `codex/kosx-landing-glass`；禁止切换 / 合入 main，禁止强推、改写历史。**
- 本次交接的正式页面基于已验收并推送的 `f3ea750237d4d555de82ff72e72a4d0c1aacdddf`，再增加交接文档和本地验收入口。
- **首页安静区、两个工作台、静态演示构建、收益与回撤调查已交付。硬币四个来回循环尚未完成整套验收，未提交正式代码。**
- 用户中途要求交接后，停止了最后一轮验证进程，保存候选补丁，并恢复正式代码。不要把中断的运行、候选截图或单项通过当作整轮通过。
- 本机目录 `F:\人工智能AI 比赛` 位于外接盘。若路径不可用，先确认外接盘连接，不要覆盖或新建同名空项目。
- 完整历史在 `implementation-notes.md`；当前可验收成果在 `review/overnight-2026-10-07.html`。

## 2. 已完成与 Git 证据

| 成果 | 提交 | 验证边界 |
|---|---|---|
| 手机两组标题各两行，按钮位于文字下方 | `2298826` | 已有首屏三尺寸回归 |
| 投资工作台：手稿背景、静态玻璃、步骤导航、唯一信号焦点 | `171842c` | check / 46 项 test / smoke；投资三尺寸、既有 UI、catalog 基线 |
| 店主工作台：缺口突出、账单 / 现金 / 成本纵向步骤 | `d96adfd` | 两工作台三尺寸核心流程、既有 UI、catalog 基线 |
| 静态演示：原演示计算代码在浏览器运行 | `c77807e` | 三尺寸双流程、金额与 Node 对照、导出、SHA-256、错误状态、无 API 网络请求 |
| 收益与回撤相同的调查 | `1e512e4` | 原公式独立计算；反例验证，未改公式 / 数据 |
| 静态跳转入口 favicon 404 修复 | `0349012` | 延迟跳转暴露 favicon 请求；静态三尺寸通过 |
| 标题安静区、液体降权、微波动、手机常驻提示 | `f3ea750` | check / 46 项 test / smoke；explore / liquid / landing / static 三尺寸及 catalog 旧基线全部通过 |

以上提交均在完成时推送，并用 `git ls-remote` 核对过。接手时仍需核对远程是否有新提交。

## 3. 队友怎样检查当前成果

先安装仓库已声明的开发依赖，再生成静态演示；没有新增生产依赖：

```powershell
cd chenchen
npm install
npm run build:static
cd ..
node review/serve.cjs
```

- 报告：http://127.0.0.1:4179/
- 完整首页：http://127.0.0.1:4179/demo/
- 投资页：http://127.0.0.1:4179/demo/investment.html
- 店主页：http://127.0.0.1:4179/demo/merchant.html

这些是各自电脑上的本地地址，**不是公网分享地址**。静态文件位于 `chenchen/dist-static/`，已忽略、不提交产物；构建后不需要 Node 业务后端，但需 HTTP(S) 托管，不能直接双击模块 HTML。

当前正式首页有 K→橙色金属硬币滚动、安静区和可点击液体天平；**尚无独立小硬币的四来回抛接**。不要因为这一效果缺失而误判打开了错误版本。

## 4. 下一项必须完成：硬币循环

限定改动：首页表现层 `chenchen/versions/archive.js`、`landing.css`，必要时 `landing.html` / `landing.js`，及测试、截图、说明。不改工作台业务、接口、金额、计算、数据。

要求：

1. 复用首屏 SVG 画法，独立小硬币，桌面约 44–56px、手机 36–40px；不搬动首屏大硬币。装饰必须 `aria-hidden`、不可点击、不遮挡标题、按钮或链接。
2. 两侧开场注入结束后开始。每次落入液位 +4%，给水面对应列冲量；约 3 秒飞到另一侧。01→02→01 为一来回，**9 次落入 = 4 个来回**，之后停止。
3. 最后两侧回到相同基础液位 34%、天平水平。桌面停在横梁支点，手机停在两卡间隙，淡出为静止状态。
4. 用户点击优先：立即暂停并淡出硬币；停手超过 **4 秒**且天平回正、用户液滴落完后，从中断位置继续，累计次数不能重置。
5. 手机每张卡分别进入视口才开场；循环需两张卡均完成开场。沿卡片外侧空白通道抛接，避免穿越纵排卡片文字。
6. 与液体共用 rAF；离屏、页面隐藏时停止。reduced-motion 无循环，静止硬币留在支点，液位点击直接更新。
7. 自动循环不能装满；保留手动注满拒绝、FULL、满时无缝、键盘操作、上滚再返回状态、0.4× 开场慢动作。

## 5. 本机候选与如何恢复

以下在 `chenchen/artifacts/` 内，**仅本机保存，不在 GitHub**；原用户内容未删除：

- `overnight/claude-coin-candidate.patch`：交接时冻结的 tracked 文件补丁，基于 `f3ea750`。
- `overnight/claude-candidate/coin-toss-check.cjs`：候选循环验收脚本。
- `overnight/claude-candidate/interrupted-validation.json`：最后一次中断运行的已落盘结果。
- `overnight/claude-candidate/coin-*.png`、`coin-toss-report.json`：候选截图 / 单项通过结果，不是整轮放行证据。
- `overnight/stage2-pointer-failure.json`、`stage2-drain-failure.json`：失败证据。
- `overnight/stage1-final.json`：已提交安静区的完整通过记录。
- `overnight/historical-failures/`：更早首屏失败证据，已移入本地档案保留。

在确认工作区干净、补丁不会覆盖协作者改动之后，先检查再应用候选；从仓库根目录操作：

```powershell
git apply --check chenchen/artifacts/overnight/claude-coin-candidate.patch
git apply chenchen/artifacts/overnight/claude-coin-candidate.patch
Copy-Item -LiteralPath chenchen/artifacts/overnight/claude-candidate/coin-toss-check.cjs -Destination chenchen/scripts/coin-toss-check.cjs
```

若只能读取 GitHub，没有本机 artifacts：从第 4 节实现，参考第 6 节避免重踩问题。不要宣称已经取得或运行本机候选。

## 6. 已发现的问题与当前判断

- **SVG 只显示 ¥、没有币面**：克隆时继承首屏 `.coin-material` 的 `style="opacity:0"`。候选已移除克隆币面的 class 与 style，并独立重命名渐变 ID；增加币面 opacity=1 断言。
- **轨迹遮挡**：旋转后的外接矩形比直径大。候选桌面先升入空白通道、横移、落下；手机经过左侧空白通道，通道中不自转，最后进卡片间隙不加上拱。候选三尺寸完整轨迹遮挡检查曾通过。
- **运动按钮点击测试等待太久**：`locator.click()` 自动等待倾斜容器稳定，可能错过连续点击窗口，甚至等待到循环结束。改为读取当前按钮框，用真实鼠标坐标点击；连续注入间隔 70ms。保留原所有满液位 / 拒绝 / 回落断言。
- **当前主要未闭环项：回落验收偶发超时**。修正点击后，满液位和拒绝注入已通过，但曾在 25 秒内回到 34% 的等待超时。独立探针约 30fps 时，4 秒开始回落、约 18 秒到 34%，未复现卡死。
- 源码确认旧回落使用 `dt=Math.min(realDt,.04)*scale`：低于 25fps 时会少算经过时间。最后候选已把回落改为 `.05*realDt*scale`，水面求解仍保留稳定步长上限。**这项修正尚未完成整套回归**，不能据此宣布问题解决。
- 候选循环单项曾在 1440 / 1024 / 375 全部通过：4 来回、点击暂停恢复、离屏停止、模拟 visibilitychange、reduced-motion、无文字区域碰撞；自动循环液位最高约 38%。当前应重新验证最新候选，不沿用旧通过记录。
- 不要把辅助文件命名成 `*-test.cjs` 放在 artifacts 下：Node 默认 `--test` 会发现并执行它。曾因此发生生成脚本误入测试，已改名；正常业务测试为 46 项。

## 7. 恢复后的验收顺序

先核对分支、远程与差异，再检查语法和业务测试：

```powershell
git branch --show-current
git status --short
git remote -v
git ls-remote origin refs/heads/codex/kosx-landing-glass
cd chenchen
npm run check
npm test
```

`npm run smoke` 需要运行中的服务：另开终端，在 `chenchen` 中设置 `PORT=4177` 环境变量后启动 `node server.js`；检查终端使用同一端口。

```powershell
$env:PORT='4177'
npm run smoke
node scripts/liquid-balance-check.cjs
node scripts/coin-toss-check.cjs
node scripts/explore-check.cjs
node scripts/landing-archive-check.cjs
node scripts/static-check.cjs
node scripts/workbench-archive-check.cjs
node scripts/archive-check.cjs catalog
```

优先跑 liquid，先闭环回落问题。保持 1440 / 1024 / 375，无溢出、文字重叠、控制台错误。`archive-check catalog` 的旧基线在本机 artifacts 内；远程环境若缺失，先从稳定提交 `f3ea750` 生成隔离基线，再比较候选，不能用候选自己重建基线当作通过。

两条核心业务流程必须保留：投资“填入演示偏好→开始健康检查→展开方案细节”；店主“打开账单→勾选已看懂→生成提醒”。固定示例金额不变，投资总资产 ¥31,080.00，店主余额 ¥6,200.00。

全通过后更新本轮截图及 `implementation-notes.md`、晨间报告，再提交：

```powershell
git commit -m "feat(ui): coin toss loop across the liquid balance"
git pull --rebase
git push origin codex/kosx-landing-glass
git rev-parse HEAD
git ls-remote origin refs/heads/codex/kosx-landing-glass
```

先逐个选择本轮文件暂存，不使用不加区分的全仓库暂存。若 pull 引入改动，需要审查并重跑受影响验收。不得推送未通过代码。

## 8. 保留边界与队友重点验收

- 不动 `prototypes/`、`learning/`、`output/`、`tmp/`、根 `.gitignore`；不新增生产依赖。
- Firefox / WebKit 未安装，用户明确不下载，记为未覆盖。当前主要浏览器证据是 Chrome。
- 可选旧 CSS 清理未做：禁用两份旧样式会使投资页 13 个、店主页 63 个受测节点变化。继续保留引用，不以破坏画面为代价删掉。
- 不添加铅笔、社群宣传、设计讨论区、可见 JSON 编辑框、重复状态栏；打开网站仍先进入展示首页。
- 只借黑橙配色和手稿气质，不复制第三方商标、字体、素材。工作台唯一信号橙优先风险 / 主操作，不引入品牌橙。
- 收益与回撤相同是当前价格路径起点最高、终点最低的结果，非同一字段错误，且并非严格单边下跌。完整证据见 `docs/investigation-return-vs-drawdown.md`；不要为了制造差异改公式。
- 当前可验收：手机标题 / CTA、标题安静区和注入提示、两工作台步骤与风险重点、两条完整流程、静态版刷新重置边界。硬币候选留给后续验收。

## 给 Claude 的执行指令

请先读取本文件、AGENTS.md 和 implementation-notes.md，核对 Git 当前分支与未提交内容。从“硬币循环最后一次候选回归未完成”继续；优先确认回落计时，不重做已经提交的两个工作台或静态构建。每轮验证通过后提交并推送，核对本地与远程 SHA。失败记录证据，不上传失败实现。完成后更新图文验收报告，并提供队友可复现的预览步骤和真实可用的链接。
