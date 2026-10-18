# 长文本 → 风控工作台集成验收

2026-10-18，北京时间。已在团队仓库完成代码集成与本机端到端验证；原线上站点尚未发布本次变更。

## 启动与操作

需要完整仓库和 Node.js 22+。在仓库根执行：

```powershell
npm.cmd ci --prefix docs/safety-risk-eval/contracts
node modules/safety-risk-eval/server.cjs
```

Windows 可双击 [start-workbench.cmd](start-workbench.cmd)。打开 <http://127.0.0.1:8780/risk>，选择“用一段话填写生活安排”。

1. 输入虚构生活计划，拆分后查看预算概览；点击“结合已识别金额，生成在线资金建议”可先得到具体预算、风险说明与补充问题。该入口允许缺少付款日期，使用当前草稿，不代替核对。
2. 需要逐日风控或沙箱记账时，核对每条金额、日期、周期及是否计入。缺失的已有占用、费用必须明确填写。
3. 逐项勾选并确认本版本，查看确定性测算与现金流。
4. 点击“提交工作台并调用在线模型”，登记同一个日常资金任务，并向团队 Core 发送已核对的虚构原文和资金信息。
5. 进入工作台，查看同一任务的来源、规则结果、模型解释、版本和审计。只有规则允许且明确确认后，才能进行沙箱记账。
6. 修改请从工作台的“返回长文本入口修改并重新核对”进入。修订继续使用原任务，旧确认与模型结果失效；已执行的任务不能被修改成未执行。新场景从工作台长文本入口新建。

本模块不接真实账户，不执行真实交易。模型仅作只读解释，模型意见不覆盖确定性风控，也不代替用户确认。

## 代码与接口

本分支合并 Risk 的 `codex/daily-risk-workbench-v1`（`9e0a105`），在既有长文本提交 `ee92de9` 上集成；保留原分支历史及两套既有测试，未改 Core 代码或风控规则算法。

- `modules/safety-risk-eval/long-text.cjs`：把逐项核对的事实交给现有 `DailyGateway`；持久化草稿与任务关联。
- `modules/safety-risk-eval/planning-model.cjs` 与 `/api/safety/long-text/plan-review`：将未确认草稿的已知金额整理为人民币元，要求实际模型结合预算分析；金额、内容与追问检查不通过时最多重试一次。支持段落和标题，保留模型原文与运行凭据。每草稿6次，计入全站每日30次上限；原有正式任务仍为3次。
- `/risk/long-text`：集成页面；普通表单不覆盖长文本动态用途。
- `/api/safety/long-text/{intake,revise,correct,confirm,restore,export,review-draft,handoff}`：沿用 `risk_session` Cookie 与 `X-Risk-Csrf`。除 intake 和 restore 外，必须提交 `{draft_id, revision, interpretation_sha256}`；纠错等字段沿用 [API.md](API.md)。restore 仅接受 `{draft_id}`，handoff 仅接受版本绑定。
- `/api/safety/daily/model-review`：只接受服务端任务编号，向团队 Core `/api/review` 调用在线模型。校验运行编号、输入摘要、模型原文、提议摘要与审计关联；失败保留失败状态，不生成成功替身。
- `/api/safety/confirm`、`/api/paper-trade/execute`、`/api/safety/audit`：复用原工作台审批、执行前重查、幂等回执及审计。
- `hosting/worker.mjs` 和 `hosting/build.mjs`：相同接口已加入云端 Worker，使用已有 D1 状态与会话锁，无新增数据库迁移。

解析本身仍为可解释的规则解析＋人工核对。在线模型可解释未确认预算与已核对场景，页面分别标明状态；不提供模型审批。

## 测试证据

本轮草稿在线建议优化：联合回归398项通过；新增真实金额单位、逐项预留、自然段展示、完整追问、泛化重试、版本失效与HTTP隔离检查。实际打包的Worker也验证了新接口、D1建议保存和纠错失效（供应商响应为明确标记的测试替身）。本地页面另用实际团队在线模型验收预算、风险和5条完整追问；用户案例与截图保留本机，不提交仓库。

以下为初始完整任务集成的历史验收：

| 验证 | 结果 |
| --- | --- |
| 长文本、原 Risk、契约、云存储联合回归 | 382 项通过，0 失败、0 跳过 |
| 原 Core 回归 | 193 项通过，语法检查通过 |
| 实际打包后的 Worker＋SQLite D1 | 页面资源、草稿、纠错、确认、handoff、共享任务、沙箱记账、重发与审计通过 |
| 在线模型实际调用 | 团队 Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`；冲突与调整后两次结果均校验通过 |
| Chrome 页面操作 | 从工作台进入→5项拆分→核对→在线复核→返回同任务→明确确认→沙箱执行→重发回执通过 |
| 持久化 | 本地重启可恢复原草稿；D1 多次打开/关闭后来源、模型、回执和审计保留 |
| 手机 390×844 | 工作台、长文本无整页横向溢出；浏览器控制台无 error/warn |

真实调用编号、输入摘要、模型摘要及6组流程断言见 [在线验收 JSON](evidence/workbench-live-20261018.json)。截图：[桌面沙箱结果](evidence/workbench-desktop.png)、[手机沙箱结果](evidence/workbench-mobile.png)。模型可能保留“需要核实”的意见，页面如实展示；规则 ALLOW 不是账户已核验或收益保证。

本轮复现并修复：已有占用映射成用途导致现金流高估；北京时间凌晨日期被视为未来；模型等待期间资料变化仍可能附着旧回答；普通表单覆盖动态长文本来源；请求中继续编辑导致前端草稿版本滞后。

复测命令：

```powershell
node --test modules/safety-risk-eval/test/*.test.cjs team-staging/risk/long-text/test/*.test.cjs modules/safety-risk-eval/hosting/test/*.test.mjs docs/safety-risk-eval/contracts/tests/*.test.cjs
npm.cmd test --prefix chenchen
npm.cmd run check --prefix chenchen
npm.cmd ci --prefix modules/safety-risk-eval/hosting
node modules/safety-risk-eval/hosting/build.mjs --check-only
node modules/safety-risk-eval/hosting/check-long-text-worker.mjs
# 明确执行两次真实模型调用；服务需先启动。仅发送脚本内的虚构资料。
node modules/safety-risk-eval/scripts/check-long-text.cjs http://127.0.0.1:8780 --live
```

`--check-only` 仅验证构建，生成忽略的 `output/risk-build-check`，不创建或伪造站点身份，不部署。

## 保留边界与线上发布

工作台沿用最多20个保护用途、40笔预计收入；周期展开超限明确提示缩短区间，不截断或漏算。模型输入最多2万字符，过长明确拒绝复核；每任务最多3次调用，每天最多30次。草稿核对有效期从创建起30分钟；过期来源阻止新的确认或执行，已完成回执仍可查询。原文与审计在工作台本地日志或云端 D1 中持久化，业务身份仍为虚构会话身份。

原站 `https://fund-risk-workbench.panxintian44.chatgpt.site/risk` 不在当前 Sites 连接可编辑列表中。因此未更新原站，也未新建替代站点。站点负责人提供原项目编辑权限后，应按原项目身份和访问范围发布本构建，并在原域名复跑 `check-long-text.cjs --live`。联合验收、真实账户证据、正式 Risk 回调与正式执行权限仍由对应团队负责。本分支不写入 `team-release`，不合并主分支。
