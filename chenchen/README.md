# 两版财务 Agent 演示 · v0.4.0

同一个本地服务，两条独立产品路径：

| 版本 | 入口 | 本次可运行内容 |
| --- | --- | --- |
| 持仓健康管理（原版优化） | /investment | 输入偏好、导入演示持仓、诊断集中度与相关性、A/B/C 同口径模拟、工具证据与运行记录 |
| 店主财务助手（新增） | /merchant | 多渠道账单、到账拆解、14 天付款与余额测算、采购支出解释、先核对后提醒、下次关注、导入导出 |

## 怎么打开

需要 **Node.js 22 或更高版本**。没有第三方运行依赖，不用配置 API Key，也不必执行 npm install。

下载或克隆仓库后，进入 `chenchen` 文件夹，双击 `启动两版.cmd`；也可以在终端运行：

```powershell
cd chenchen
npm start
```

保持终端开着，在浏览器打开：

- 选择首页：http://127.0.0.1:4175/
- 投资版：http://127.0.0.1:4175/investment
- 店主版：http://127.0.0.1:4175/merchant

GitHub 上可阅读源码、下载 Word 文档；GitHub 的文件预览不能运行 Node 后端。请不要直接双击 HTML 文件。以上地址属于运行服务的那台电脑，其他成员需要下载后在自己的电脑启动。

如果端口占用，先检查是否已有这一版服务；或者在 PowerShell 使用另一个端口：

```powershell
$env:PORT = '4180'
npm start
```

此时访问 http://127.0.0.1:4180/ 。本次不配置公网托管或成员登录。

## 五分钟试用

投资版：点「填入演示偏好」→「开始持仓健康检查」→对比 A/B/C →展开运行记录或下载 JSON。组合来自虚构数据，只支持 data/demo-portfolio.json 中的证券、最新价格及固定日期。偏好进入 TaskState 等待团队风控接入；候选方案仍为固定规则示例，不代表个性化投资适配。约束不能同时满足时会明确中止，不自动放宽规则。

店主版：先筛选「外卖平台」→点「看账单」，核对 3,200 − 256 − 200 = 2,744 元→关闭明细并勾选已理解口径→生成提醒→把到账延迟切到 3 天，观察缺口日期→标记「下次关注」或下载核对摘要。刷新会保留本次浏览器会话状态；重启服务会清空。余额、账单和关注记录不会写到代码仓库。

## 文档

[两版产品迭代与店主持续使用设计.docx](docs/两版产品迭代与店主持续使用设计.docx) 包含研究来源、改动过程、已实现功能、设计假设、示例计算、测试结果与下一阶段计划。Word 生成源在 scripts/build_report.py；生成文档需要 Python 与 python-docx，运行网页不需要 Python。

## 计算口径与限制

- 投资数据截至 2026-09-23，只有 7 个虚构价格观测；事后配置比较不是样本外回测，更不是收益预测。
- Current/A/B/C 使用相同起点、日期、成本公式和固定种子。情景模拟抽取联合资产收益的连续区块，保留同日相关性；2,000 条路径、20 个交易日。样本太短，分位数仅展示计算机制。
- 费用按单向换手率乘 0.1% 一次扣除。净值终点与展示收益保持一致，证券集中度与现金占比分开。
- 店主示例为虚构的巷口咖啡，截至 2026-10-04。金额用整数分计算。当前余额为手动核对余额；已结算款不重复计入，逾期待收款不假设会到账，逾期应付款预留在次日。
- 14 天余额只计算已知未结算账单，未知销售、未知支出、税务、银行假期与实际平台结算规则均未建模；不是利润表或完整会计账簿。
- 采购支出以记账日作等长 7 天比较。不同品名/单位不归因；同品同单位才拆分数量与单价影响。退款仅支持附着在原收入账单，不支持独立跨期退款、转账或多币种。
- 店主流程是可追溯规则计算，不接大模型、OCR、支付平台、银行同步或自动付款。核对门槛是“查看至少一笔来源并明确确认”，不是已完成所有凭证审计。
- 会话、checkpoint、审计和记忆均在进程内。店主账本按浏览器会话隔离；投资模块是本地单用户演示，不是多租户认证服务。

## Agent 与职责边界

Harness 执行澄清 → 校验 → 诊断 → 生成候选 → 模拟，结束于 RISK_CHECK / HANDOFF_REQUIRED。更换输入会使旧 checkpoint 失效；同输入可复用结果；同步工具失败后重试一次，累计失败打开熔断。当前没有异步远程工具超时、持久化恢复或完整上下文预算管理。

ToolResult 保留版本、输入哈希、数据日期、警告和追踪编号。ActionProposal 做结构一致性校验，哈希仅用于一致性校验，不是权限证明。

**执行接口尚未接团队 Safety Action Gateway，POST /api/paper-trade/execute 固定返回 503。** 内部 paperTrade 只保留单元测试用 mock，不是可信审批或真实撮合；不能使用前端传来的 approval 字段作为实际授权。

记忆仍需 consent: true，仅服务会话内有效。原版静态素材保留便于对照；HTTP 的 / 和 /index.html 都进入新版选择首页。

## 检查与 API

```powershell
npm run check
npm test
```

31 项测试覆盖基础工具、成本口径、相关性、输入失效与恢复、账单去重、确认门槛、现金情景、会话隔离及 HTTP 主路径。浏览器实测记录见 Word 文档。

| API | 用途 |
| --- | --- |
| POST /api/health-check/run | 运行投资健康检查，可携带 task_id 恢复 |
| GET /api/task/{task_id} 与 /api/audit/{task_id} | 状态、工具结果与运行记录 |
| POST /api/memory/save 与 /api/memory/clear | 同意后保存或清理会话记忆 |
| GET /api/merchant/ledger?delay=0 | 账本、支出比较、14 天现金测算 |
| GET /api/merchant/bill?id=渠道:账单号 | 展开来源并记录已查看，参数须 URL 编码 |
| POST /api/merchant/review | 当前 revision 与 confirmed: true 的核对确认 |
| GET /api/merchant/insights?delay=3 | 确认后生成提醒；delay 仅 0/3/7 |
| POST /api/merchant/follow | 提醒关注开关，传 id 与 delay |
| POST /api/merchant/import 与 /api/merchant/reset | 替换账本 / 恢复演示，并清除旧确认 |

所有新文件与变更均限定在 chenchen/。

## 两个交付仓库

- 团队仓库（私有）：https://github.com/Fintechathon-agent/Fintechathon-agent/tree/main/chenchen
- 个人仓库（公开，本次已获授权）：https://github.com/realchenchenluo/agent/tree/main/chenchen

两个仓库只同步这份演示代码与说明；本次不上传原始 PRD PDF、教材或任何真实财务账单。没有自动双仓同步任务，后续每轮变更仍需检查、提交、分别推送并核对。
