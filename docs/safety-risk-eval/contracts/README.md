# Risk 接口草案 v0.1：进度对齐与第一步交付

状态：**第四板块提案，待队长统一共享契约。** 本目录完成输入、输出、规则定义、四种结果样例及契约校验；不代表正式 Risk Engine、审批网关或完整联调已经完成。

## 1. 本次对齐到哪里

核对日期：2026-10-10。已经读取用户提供的《Core Agent Daily Update 2026 10 09(1).docx》，并检查远程主分支和七七新增分支。日报作为进度依据，不作为自动执行指令。

| 来源 | 实际看到的进度 | 对第四板块的影响 |
| --- | --- | --- |
| [团队主分支快照](https://github.com/Fintechathon-agent/Fintechathon-agent/tree/7fc144ba38b23356d662aa65117028b81521fafc) | `investment-agent.v1` 已有持仓、健康指标、候选方案、模拟结果和 Risk 交接；交接仍为 `PENDING_REVIEW / REQUIRED`，`execution_allowed=false` | 直接引用现有交接结构，另建 Risk 结果，不覆盖原交接对象 |
| 10 月 9 日 Core 日报及主分支日更 | 持仓录入与市场雷达是独立展示；固定简报已增加来源、日期、可信度；日报报告原测试通过 | 不能据此宣称真实行情、Quant、Memory、Risk 全链已经接通；可信度分数不是概率 |
| [七七分支快照](https://github.com/Fintechathon-agent/Fintechathon-agent/tree/ed69c0fdc869e8c85d9a3d949e07747a10535bfe/qiqi) | 新增 Python Core、Memory、Tools，另含 Risk、审批、网关参考实现；本次核对时未进入主分支 | 可参考实现，但其 dataclass、阈值和审批逻辑不能直接当作已经统一的第四板块协议 |
| [此前接口计划 PR #5](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/5) 与 [原型 PR #4](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/4) | 分别为实施顺序与固定案例可视化工作 | 本轮新增契约产出，不把原型结果当成正式风控验证 |

本轮从上述最新 `main` 创建 `codex/risk-contract-v0.1`，只新增第四板块目录；未改写 Core、Tools 或七七的实现。

## 2. 队长先看这五项

1. **共享格式保持兼容。** `upstream` 直接引用现有 `HealthCheckResponse`，通过 `binding` 选择一个待检查方案；三个方案分别检查，不能用一个通过结论覆盖全部方案。
2. **风险结果统一四种。** `ALLOW / REVIEW / BLOCK / ERROR`；检查结果、用户确认、执行状态独立。
3. **先检查方案，再检查执行条件。** `PLAN_REVIEW` 检查 R01—R07；R08—R10 标注此阶段不适用。`EXECUTION_PREFLIGHT` 必须覆盖全部十条，实际调用前由执行入口拦截。
4. **通过不代表授权。** Risk 结果始终携带 `execution_allowed=false`，含义是此结果本身不授予执行权。后续网关需结合版本绑定、风险接受、完整计划确认、幂等和审计另行决定能否调用模拟执行。
5. **默认值不能冒充用户同意。** 画像确认、备用现金、禁止资产等缺失时保留 `null` 或未知项，不能静默填零、填空名单后输出通过。

## 3. 文件入口与运行

| 文件 | 作用 |
| --- | --- |
| `risk-input.schema.json` | Risk 接收的数据；引用主分支契约，不复制或修改共享字段定义 |
| `risk-output.schema.json` | 四种结果、逐条检查、原因、暂停功能、审批与审计快照 |
| `common.schema.json` | 方案绑定、原因、数值口径、用户确认、执行状态 |
| `risk-rule.schema.json`、`rules/R01.json`—`R10.json` | 标准规则格式及十条配置；是声明式规划数据，不是规则解释器 |
| `examples/*.input.json`、`*.output.json` | 四组可独立读取的完整请求和预期响应，无省略号或外部样例占位 |
| `examples/manifest.json` | 来源提交、预期结果和故意错误的说明 |
| `validate.cjs`、`tests/contracts.test.cjs` | 离线 JSON Schema 和跨字段关系校验；不生成金融结论 |

在本目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm test
```

锁定 Ajv 8.17.1、ajv-formats 3.0.1；使用 JSON Schema 2020-12，引用本地 `chenchen/contracts/investment-agent.v1.schema.json`，校验过程不访问网络。安装依赖需要网络。Node 需不低于 22。本次 Windows 环境使用 Node 24.19.0；受限环境不允许创建测试子进程时，可使用 `node --test --test-isolation=none tests/contracts.test.cjs`。

## 4. 输入如何交接

| 输入段 | 必要内容和口径 | 提供方 |
| --- | --- | --- |
| `upstream` | 原始 `investment-agent.v1` 响应，包含持仓、研究/指标证据、候选方案、模拟结果、工具来源和 Risk handoff | 第一板块路由，第二/三板块产出 |
| `binding` | 请求、交接、任务、会话、用户、方案 ID；候选内容摘要；完整计划摘要；方案、画像、约束、数据、交易规则、风控规则版本 | 第一板块统一；各版本由实际所有者维护 |
| `context` | 可信用户与持仓归属、已授予工具范围、拟调用工具和操作、环境、身份来源 | 第二板块提供可信运行上下文；前端不能自行授予权限 |
| `profile` | 用户是否确认、确认人/时间、未知项、备用现金、历史回撤容忍值、允许/禁止资产 | 第二板块保存，第五板块收集确认 |
| `plan` | 比较或模拟用途、数据模式、完整步骤、日期、订单数量与参考价格/费用、现金、可卖数量、改善重点 | 第一板块组织，第三板块提供可复算执行计划 |
| `data_context` | 来源、时间、版本、用途、有效性政策、ETF 行业权重及未知比例、交易规则来源 | 第三板块 |
| `approval` | 确认状态、人员、时间、有效期、对应检查 ID、完整版本绑定、逐项风险接受记录 | 第五板块采集，第二板块持久化，第四板块验证 |
| `execution` | 状态、执行 ID、幂等键、内容摘要、已有结果引用 | 第三板块执行入口，第二板块存储 |
| `audit_context` | 关联 ID、执行前记录是否成功及记录 ID | 第二板块可靠存储，第四板块定义内容 |

`requested_operation` 即将执行的行为与 `plan.purpose` 分开：可以请求分析一个拟模拟方案，仍未请求执行。前端隐藏按钮不能替代服务器校验。`identity_source=DEMO_FIXTURE` 只用于队内样例，不表示真实身份已认证。

当前四组样例使用主分支 Harness 实际输出作为上游，补充虚构用户和 A 方案的持有计划。持有步骤无买卖订单，现金和可卖数量没有变动；`trading_rules=null` 表示没有提供规则，绝不代表支持股票/ETF 的完整执行模型。新增有买卖的计划必须提供对应交易参数，否则暂停相关回放/执行。主分支的 A/B/C 目标配置并不等同于早期产品设想中的“持有/四周/立即”；本轮按 `proposal_id` 关联，不擅自重命名或修改队友策略。

## 5. 统一口径与两套代码的差异

| 数据 | 主分支 | 七七分支 | Risk 草案约定 |
| --- | --- | --- | --- |
| 资产代码 | `instrument_id` | `symbol` | 明确映射，不能依靠中文名称猜代码 |
| 总资产 | `portfolio_snapshot.total_value` **含现金** | `Portfolio.total_value` **不含现金**；`total_assets` 才含现金 | 总资产分母 = 证券市值 + 现金；投资部分分母 = 证券市值 |
| 历史最大回撤 | `simulation.comparisons[].metrics.max_drawdown` 为负比例 | `RiskReport.max_drawdown` 当前来自最差持仓收益的放大估算 | R06 只接指定历史净值样本的回撤；主分支转为正幅度再比较。禁止把简化估算直接改名接入 |
| 百分比 | Quant 多用小数比例，市场 `change_pct` 用百分点 | `return_pct`、`day_change_pct` 用百分点，用户损失配置用比例 | 统一明确单位：`0.1` 表示 10%；4.15 个百分点需除以 100。不能根据字段名猜测 |
| 用户限制 | 期限、回撤容忍、流动性需求，尚无完整确认版本 | 有损失/行业默认配置与 Memory 用户确认标记 | 默认值不等于确认；`max_total_loss` 不能自动映射历史回撤，禁止行业不能自动变成禁止资产 |
| 方案与确认 | 候选权重、动作、`proposal_hash`；执行网关未接 | 推荐结构含数量、信心；`requires_approval` 依据信心判断 | 每次模拟执行必须确认完整计划，信心高不能跳过确认；摘要不等于授权 |
| 风险结果 | 原交接 `REQUIRED`，等待第四板块 | `GateResult.passed`、告警、阻止原因、`fail_closed` | 使用四态结果；不能把 `passed=true` 无条件转成 ALLOW，需完整规则覆盖 |
| 阈值 | 候选生成器有局部策略约束 | 参考 Risk/Gate 有行业 30%、集中度 50% 等配置 | 采用第四板块十条规则草案，候选生成参数不具备覆盖用户约束的权力 |
| 行情模式 | 接收固定 `REFERENCE_FIXTURE` 简报 | 有自动采集及 Mock 降级流程 | 自动数据不能伪装成固定数据；真实数据失败不得静默切换 Mock 后继续当前建议 |
| 审计 | 工具追踪与任务状态 | 时间/动作/用户/结果和自由扩展字段 | 需要固定风险字段及可追溯版本，不能只记录一段文字 |

ETF 行业数据的虚构补充在样例中明确标为 `AUTHORED_DEMO_CLASSIFICATION_NOT_ETF_LOOKTHROUGH`，不是已取得真实穿透持仓。行业权重加未知部分应为 1。零投资分母应呈现“不适用”，不能输出虚构的 0% 指标。

## 6. 四态、原因与 Fail Closed

| 结果 | 含义 | 后续动作 |
| --- | --- | --- |
| `ALLOW` | 当前检查阶段应检查的规则完成且通过 | 可以进入下一阶段；不能据此执行 |
| `REVIEW` | 已明确识别需要用户接受的风险，或已知的补资料/重新确认/核查状态需求 | 根据具体原因处理，不是一律弹出“同意即可” |
| `BLOCK` | 已确认的硬性禁止或约束违反 | 阻止相关执行，修改方案或约束后重检；用户确认不能覆盖 |
| `ERROR` | 必要检查无法可靠完成，例如引用错配、计算异常、必要审计失败 | Fail Closed：暂停相关执行，修复并重检 |

聚合提案：出现 `ERROR` 时总体为 `ERROR`，保留已经发现的 BLOCK/REVIEW 原因；检查可完成时 `BLOCK > REVIEW > ALLOW`。ERROR 表示证据/流程不完整，不是更高等级的金融风险。该优先级需队长确认。

`check_complete=false` 对应 ERROR；其余表示完成了本阶段判定，不表示用户已补齐复核所需资料或已授权执行。逐规则 `NOT_EVALUATED` 只允许伴随总体 ERROR；`NOT_APPLICABLE` 在本版仅用于方案检查阶段的 R08—R10，不能用来掩盖应检查的规则。

每个原因固定携带 `reason_id / rule_id / code / decision / message_zh / measurements / evidence_refs / acceptance_allowed / recovery`。数值携带单位、分母、比较符号与阈值。证据引用为相对于整份 Risk 输入的 JSON Pointer，引用失败不能只显示解释文字。

可以明确接受的原因限定为：历史回撤、高相关集中、行业信息未知、合格的逐步改善例外。补资料、更新数据、重新确认、执行结果核查都不能靠接受风险放行。已知硬超限不能通过接受未知信息覆盖。

若请求根本无法解析、版本或外层格式不成立，入口沿用共享 `HealthCheckErrorResponse` 返回协议错误并停止路由，不伪造用户/方案绑定来构造完整 Risk 输出。本例 ERROR 是已经能定位任务、但内部证据错误的情况。

## 7. 十条规则与固定原因

| 规则 | 主要固定原因代码 | 处理和边界 |
| --- | --- | --- |
| R01 | `PERMISSION_DENIED`、`REAL_TRADE_FORBIDDEN`、`TOOL_NOT_ALLOWED`、`EXTERNAL_PERMISSION_OVERRIDE` | BLOCK；外部文字不能赋予权限，真实交易禁止 |
| R02 | `DATA_MISSING`、`EVIDENCE_MISMATCH`、`VERSION_MISMATCH`、`DATA_STALE`、`CALCULATION_FAILED`、`UNSUPPORTED_DATA_MODE` | 可明确补填的信息进入不可勾选的 REVIEW；依赖数据不可用、证据错配或计算失败为 ERROR |
| R03 | `INSUFFICIENT_CASH`、`INSUFFICIENT_SELLABLE_QUANTITY`、`RESERVE_CASH_VIOLATION`、`FORBIDDEN_ASSET` | BLOCK；费用、各步骤现金和可卖数量都需要核对 |
| R04 | `SINGLE_ASSET_LIMIT_EXCEEDED`、`TOP_THREE_LIMIT_EXCEEDED`、`GRADUAL_IMPROVEMENT_ACCEPTANCE` | 单只/前三：总资产 35%/75%，投资部分 50%/90%；普通超限 BLOCK，合格改善例外 REVIEW |
| R05 | `SECTOR_LIMIT_EXCEEDED`、`SECTOR_INFORMATION_INCOMPLETE`、`GRADUAL_IMPROVEMENT_ACCEPTANCE` | 行业：总资产 40%、投资部分 60%；已知超限 BLOCK，信息未知 REVIEW；合格改善例外同 R04 |
| R06 | `MAX_DRAWDOWN_EXCEEDED` | 指定历史回撤幅度超过用户确认的容忍值，REVIEW；不是未来损失上限 |
| R07 | `HIGH_CORRELATION_CONCENTRATION` | 同一对资产：相关系数 ≥0.8 且合计总资产占比 >40%，REVIEW；记录样本窗口 |
| R08 | `APPROVAL_REQUIRED`、`APPROVAL_REJECTED`、`APPROVAL_INVALIDATED`、`RISK_ACCEPTANCE_REQUIRED` | 未确认/版本失效/未接受风险 REVIEW，已拒绝或撤回 BLOCK；全部暂停执行 |
| R09 | `DUPLICATE_EXECUTION`、`IDEMPOTENCY_CONFLICT`、`EXECUTION_RESULT_UNKNOWN` | 已成功请求返回既有结果、不产生新写入；未知结果 REVIEW 并核查；同键不同内容 BLOCK |
| R10 | `PRE_EXECUTION_AUDIT_FAILED` | 必要执行前记录失败 ERROR；不能继续调用执行工具 |

以上数值都是队内演示配置，不是监管标准；上限严格按“超过”触发。`conditions.group=PAIR_AND` 表示 R07 两项必须在同一资产对同时成立，R04/R05 任一超限即可触发。R06 阈值通过字段引用读取，不能用固定假设替代用户确认值。

逐步改善例外：用户选定重点必须严格下降；两个分母下均不得新增或加重其他硬超限；仍超限部分逐项接受。未知行业不能用于证明改善，R01/R03 不能适用该例外。当前持仓超限仍可诊断/比较，执行资格另判。规则 JSON 中保留这些前提，本轮不实现自动判定。

## 8. 确认、执行与审计交接

用户确认状态为 `UNCONFIRMED / CONFIRMED / REJECTED / REVOKED / INVALIDATED / EXPIRED`。确认人必须与可信用户匹配，确认覆盖完整计划、数据模式、摘要及相关版本。相关画像、数据、交易规则、风险规则或计划内容变化后重检、重新确认；无关资料变化不升级上述版本。历史记录保留原版本。

逐项风险接受绑定 `reason_id + risk_check_id + user_id + binding`，不能把旧方案的“我接受”套到新方案。接受后保留原始 REVIEW 原因；满足全部条件时由执行入口取得资格，不抹除复核历史。整体计划一次确认、启动前判断有效期；历史回放每步检查资金与约束，不把历史日期当作现实中的确认过期时间。

执行状态为 `NOT_STARTED / RUNNING / SUCCEEDED / FAILED / UNKNOWN / ABORTED`。第三板块执行入口必须以持久化幂等键原子占用任务；重复请求只能返回既有状态；UNKNOWN 先核查，不能自动重试产生第二次写入。本轮只定义字段，未实现锁或执行存储。

审计事件必有：任务/会话/用户/方案与全部版本绑定、检查 ID、规则覆盖状态、四态结果、完整原因、触发指标与阈值、证据引用、数据模式、改善重点、未知信息、逐项接受与整计划确认、执行 ID/幂等信息、时间、记录状态、输入摘要和输入快照引用。全部判定输入通过受控快照保存，不能只记录触发值而丢失通过项的依据；日志按最小必要原则，不记录凭据或原始敏感对话。

当前 `audit_event` 是 **Risk 检查事件**，`checks[].measurements` 与 `metrics_and_thresholds` 同时记录通过项和触发项，包含两种分母下的数值；完整依据通过输入快照及规则版本追溯。执行成功、失败、中止、结果未知需要后续独立执行审计事件，继续使用相同关联 ID。本轮样例均为 `DEMO_NOT_PERSISTED`，不是已持久化审计证据。执行后记录失败时不能重放交易来“补日志”，应进入核查/补录路径。

`plan_hash` 与 `input_sha256` 的本地演示算法为 SHA-256(UTF-8(JSON.stringify(递归排序对象键、保留数组顺序)))。这用于契约测试，不是签名或身份认证；Python 的默认 JSON 数字表示不保证相同摘要。跨语言摘要协议须队长统一并增加黄金向量后才能正式使用。

## 9. 四组完整样例

| 样例 | 条件 | 预期结果 | 仍不能执行的原因 |
| --- | --- | --- | --- |
| [allow.input.json](examples/allow.input.json) / [输出](examples/allow.output.json) | A 持有方案；现金 10000 元，已确认备用金 5000 元；回撤容忍 10% | ALLOW | 仅方案检查；审批、执行前幂等和可靠审计尚未完成 |
| [review.input.json](examples/review.input.json) / [输出](examples/review.output.json) | 同一方案，用户容忍值改成 2%；历史回撤幅度 2.789133% | REVIEW，`MAX_DRAWDOWN_EXCEEDED` | 尚未逐项接受、尚未确认完整计划 |
| [block.input.json](examples/block.input.json) / [输出](examples/block.output.json) | 已确认备用金 11000 元，剩余现金仅 10000 元 | BLOCK，`RESERVE_CASH_VIOLATION` | 违反硬约束，确认不能覆盖 |
| [error.input.json](examples/error.input.json) / [输出](examples/error.output.json) | handoff 引用的模拟 ID 与实际结果 ID 不一致 | ERROR，`EVIDENCE_MISMATCH` | 必要检查失败；必须修复证据关系 |

固定历史样本仅 7 个观测，不能据此推导可信未来收益预测。所有 Risk 输出是手工编写的预期，不是 Risk Engine 生成。输入形状合法不等于金融事实可靠；ERROR 样例专门证明这一点。

## 10. 本轮验证与后续验收

本轮已运行：四组完整样例和十条规则的 JSON Schema/关联校验；29 项新契约测试；队友现有 `chenchen/tests/contracts.test.js` 的 4 项契约测试。均通过。包含非有限数字、百分点误用、证据错配、跨任务混用、缺失/未确认约束、版本变动、规则遗漏、硬阻止接受、原因引用、审批缺字段、执行前置条件和审计错配。

限制：校验器验证格式及部分关键关联，不验证真实身份、不重算风险、不执行交易、不证明全部 Eval Cases 通过。未在本轮运行或宣称完整主链路/浏览器/真实数据测试。

| 必须团队决定的事项 | 负责方 | 下一步 |
| --- | --- | --- |
| 本草案命名、两阶段入口、ERROR 聚合及 shared contract 升版方式 | 队长/第一板块 | 评审通过后再冻结正式接口；不把 ALLOW 写入旧 handoff.decision |
| 可信用户、已确认约束、版本递增、审批有效期、审计存储 | 第二板块 + 第四板块 | 给出可信上下文和持久化接口，避免前端自报授权 |
| 计划步骤、买卖数量、行业穿透、交易规则、数据有效性、单位与样本 | 第三板块 + 第四板块 | 补齐字段；对七七类型作显式适配，不复用简化回撤为历史值 |
| 新鲜行情与自动简报模式、Mock 降级展示 | 第一/三/五板块 | 保持来源真实、模式显式，必要时新增共享版本 |
| 确认与复核页面 | 第五板块 | 按原因逐项显示，不把所有 REVIEW 做成同一个确认按钮 |
| Risk Engine 与 Eval Cases | 第四板块 | 接口确认后实现十条判断；各规则正常、边界、异常用例随代码完成 |

接下来按顺序做：**团队评审接口 → 固定输入的正式 Risk Engine → 审批/幂等/审计执行门禁 → 联调 → Eval 报告与演示证据**。这次交付供队长评审第一步，不提前承诺队友能力或正式合规结论。
