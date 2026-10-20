# Core Agent Daily Update · 2026-10-20

## 已完成

投资分析和测试总结都改成先看结论、再看依据。投资报告新增TXT下载，网页解释默认收起。没有改变公共接口、计算规则、记忆或审批要求。

在此基础上把投资页原来被压缩掉的设计层接回：新增总览横幅、组合表现/现金缓冲/第一关注点三张重点卡片，以及总览、下一步、方案、集中度、运行记录的分区跳转。重点数字来自同一次 Core Agent 健康检查，详情和提示仍默认收起。

修复了方案为空时报告报错的问题；方案不齐全就提示补资料，不编造数字或最优方案。主链路原有阻断仍保留。

## 可以验证的进度

本轮10,000例，首轮9,900通过，修复后同数据10,000通过；项目284项回归通过。本次 UI 小迭代的页面测试6/6通过，脚本语法和差异检查通过。记录与源码指纹已核对，首轮失败保留。浏览器实际检查了总览横幅、重点卡片、分区跳转、生成报告、展开说明、下载、改输入隐藏旧结论及390像素布局。

这是本地虚构数据和替身服务验证。没有增加真实系统接通或联合验收，没有调用付费模型，没有训练或真实交易，没有替换Cloudflare生产后端。

## 需要配合落实

- 模型服务：提供已确认的调用地址和可核查响应日志；密钥通过服务器安全配置交付。
- 风控与审批：用正式服务完成同任务的判断、批准及拒绝回写。
- 集成与界面：确认待部署版本，再做公网、手机真机和全流程验收；这次新增的 UI 先在临时共创区供团队查看。

[本次完整说明](readable-report-iteration-2026-10-20.md) · [投资 UI 接回说明](investment-ui-iteration-2026-10-20.md) · [易读测试结果](benchmark-10000-readable-after-2026-10-20/测试报告.txt) · [投资报告示例](readable-report-2026-10-20/投资分析示例.txt)

---

# Core Agent Daily Update 2026 10 20 晚间收尾

## 今日结论与主链路阶段

已实现：今天报告改为先结论、再依据，新增 TXT 下载；空方案触发补资料，不编造比较结论。团队 main 另有投资总览 UI 恢复提交 6ead62e，个人 main 尚无该提交，本轮不搬运业务代码。两条主链路仍停在正式 Risk 交接及 PAPER 边界，正式 Risk 审核闭环待 Owner 确认。

今日已有业务代码变更；本次日报自动化未修改业务代码、Quant、Memory、Risk、UI 实现或运行时 Schema。保留当天早先日报；其中 UI 描述只能证明团队基线，不能推广为两个 main 完全一致。

## 今日真实产出

两仓库独立复验 284 项回归和 32 项完整 Schema 与语义追踪检查；新生成健康成功、同进程 Checkpoint 复用、失败信封证据，核验当天既有 10000 例报告的原始数据与压缩证据。更新架构图、模块时序图、统一 Contract 联调手册及 Word 日报。不是重新运行 10000 例业务场景，也不是新公网、模型或正式 Risk 验收。

## A 已完成的核心接口

| 接口及版本 | 生产方与消费方 | 当前字段状态与证据 |
| --- | --- | --- |
| investment-agent.v1 | Caller/Backend → Harness/Core → Risk/UI | request_id、trace、task_state、artifacts、tool_results、audit_evidence、risk_handoff 已实现并验证；contracts/investment-agent.v1.schema.json 与本日 trace.json |
| model-review.v1 与 review-workflow.v1 | Caller → Backend/ReviewWorkflowStore → Risk/UI | request/task/session/run/audit 可关联；WorkflowRecord.session_id 仍为可选，健康四字段无版本化统一映射；contracts/model-review.v1.schema.json |
| risk-handoff.v1 与 risk-callback.v1 | Core → Risk；Risk → Backend | 导出对象严格 Schema 通过；callback 五编号及 hash 校验已有本地回归，正式签名接收/回写待确认；contracts/risk-handoff.v1.schema.json |
| core-agent-error.v1 | Backend/Core → Caller/UI | 版本、operation、request_id、trace、error 必填；未分配编号允许 null；contracts/core-agent-error.v1.schema.json |
| buildInvestmentReport 本地只读投影 无独立协议版本 | 现有健康结果 → UI/TXT | 读取同快照的 task_state/artifacts，检查缺失/日期/演示数据边界；不修改公共 Contract；versions/investment-report.mjs 与 tests/readable-report.test.mjs |

编号、版本、工具原值和审计由所属生产模块维护，消费者不得改写。完整 required、字段归属与异常状态见本日联调手册，运行时 Schema 作为约束源，不把 UI 报告投影视为新统一协议。

## B 可验证的集成进度

- 两仓库在 chenchen 执行 npm run check：exit 0；npm test -- --test-reporter=tap：各 284/284，通过且失败/跳过 0。证据 daily-closeout-2026-10-20-check.txt 与 tests.txt。
- 两仓库在 chenchen 执行 python docs/daily-closeout-check-2026-10-20.py：各 32/32；7 个正向对象完整 Draft 2020-12 校验通过。新合成健康成功/同进程复用/失败信封；10 月 17 日留存合成模型记录的 9 条审计事件六编号与 hash 对齐。证据 daily-closeout-2026-10-20-trace.json、synthetic.json、trace.txt。模型记录不是今日新请求。
- 两仓库执行 node experiments/report-benchmark-v6/verify.mjs --output docs/daily-closeout-2026-10-20-benchmark.json：exit 0；核验同数据首轮 9900/10000、修复后 10000/10000、87 模板及 10000 个唯一完整输入；前后各 7520 条压缩工作流证据，未跳过。只核验既有报告，不将模板参数变化说成 10000 个独立业务场景。证据本日 benchmark.json 与 benchmark.txt。
- 复现依赖 Node >=22、Python jsonschema 4.26.0；本机采用 bundled Node/Python，PYTHONPATH 指向自动化独立 python-deps，CORE_AGENT_NODE 指向 bundled node.exe，未改项目依赖。完整本机命令与基线见 daily-closeout-2026-10-20-verification.json。
- 提交前执行 git diff --check 与 git diff --cached --check；本次无新公网 HTTP、浏览器、模型调用或 Risk 派发。早先浏览器与团队 UI 6/6 结果为当天留存证据，不标成本次独立浏览器验收。

## 金融数据测试与职责边界

固定 2026-10-08/09 市场夹具及价格新闻冲突、REVIEW_REQUIRED、Quant no-drift 回归通过；未核验 10 月 20 日实时行情。Core 只调用现有 diagnosePortfolio.metrics、generateCandidates.target_weights、runSimulation.comparisons；展示层使用这些结果，不重新计算 Quant。Memory consent、范围、生命周期和清理规则未改动。健康任务到 RISK_CHECK/HANDOFF_REQUIRED 即停止；格式通过不等于正式 Risk 接收，前端 approval 不能授权交易，execution_allowed=false。价格与新闻冲突只记 REVIEW_REQUIRED，不自动生成交易动作。

## C 需要其他 Owner 配合的阻塞项

- Risk：正式接收服务身份、签名回调和联合验收仍缺；需提供同任务批准/拒绝/补资料/重复/冲突/过期回写样例，并确认 provider_response_id 缺失时的拒绝与恢复协议，不能造假编号。
- Backend：健康 task_state/artifacts/tool_results/audit_evidence 与模型记录尚无版本化映射，健康 Session/Checkpoint 为进程内；需提供字段对照、跨实例幂等与持久化方案。模型存储恢复不能证明健康链路跨重启恢复。
- Backend 与 Risk：可信审批身份及 Safety Action Gateway 未验收；需受保护入口和执行前再检查 Contract，真实执行继续关闭。
- UI：两 main 的投资总览基线不同；需确认正式交付版本，并给出同任务等待/拒绝/缺资料/过期/409/503 的恢复与手机真机验收回执。本地页面及报告测试不等于正式部署。
- Memory：需提供既有 consent 下 memory_id、来源版本及撤回证据；调用方账户候选不能当作可信记忆，不扩展范围。
- Quant 与 Data：需确认现有结果版本/日期、真实持仓快照及资金来源、时效与冲突协议；预期提供可审计样例，不能用现金占比证明生活费或可投资额度已确认。

## 下一步

先由 Risk 确认可信接收/回写与回执缺失协议，Backend 冻结两链路字段映射；UI 明确采用哪个 main 基线并联验恢复状态。Memory、Quant/Data 提供可信引用与版本时效样例。继续保持交接停止点与真实执行阻断。

## Word 版式验收

日报和联调手册均嵌入架构、时序图；ZIP、文本、图片数量和宽度结构检查通过。已尝试 canonical render_docx.py，bundled 环境缺少 LibreOffice soffice.exe，未生成页面 PNG，逐页版式验收未完成。不能标记版式通过；日志 daily-closeout-2026-10-20-render.txt。
