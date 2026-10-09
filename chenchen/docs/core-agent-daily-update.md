# Core Agent Daily Update

> 用途：每天 22:00 前更新一次，供团队同步主链路进展。本文档只记录 Core Agent 主链路，不替代 Risk、Memory、Quant 或 UI 的专项日报。

## 2026-10-09

### 今日结论

Core Agent 主链路当前处于“统一 Contract 已落地，等待继续扩展联调”的阶段。投资健康检查主流程已经能够从版本化请求进入 Backend，经过 Harness 调用现有 Tools / Quant 结果，生成任务状态、分析产物、工具证据和 Risk Handoff；到达 Risk 边界后停止，不产生执行授权。

### 今日完成

- 明确 Core Agent 主链路 DRI 范围和非职责边界。
- 明确 Core Agent 不重新计算 Quant，不修改 Memory 规则，不绕过 Risk。
- 保留 `investment-agent.v1` 作为投资健康检查主流程的公共 Contract。
- 保留 `request_id`、`task_id`、`session_id` 和证据 ID 的关联要求。
- 保留 `risk_handoff.execution_allowed = false` 的安全边界。
- 建立本 Daily Update 文档，后续按日期追加，不覆盖历史记录。
- 使用用户提供的 2026-10-08 市场简报整理出固定测试夹具，不上传原始 PDF。
- 新增 `market_context` Contract 和 `market-brief.context` ToolResult，只做来源、数据日期、异常和冲突标记。
- 验证市场上下文不会改变已有 Quant 健康指标、候选方案和模拟结果。
- 验证价格与消息冲突会进入 `REVIEW_REQUIRED`，不会自动转成交易动作。
- 新建独立项目 `holdings-intake/`，用于后续研究新用户如何上传、识别、校验和确认持仓；本日不接入当前主产品。
- 新建独立项目 `fund-market-analysis/`，用于后续研究基金市场状态、类别比较、异常波动、证据链和信息冲突；本日不接入当前主产品。
- 参考 GitHub 上的 RiskEngine、Portfolio-Analysis、Dashboard、mf-analytics 等公开项目，提取“导入校验、来源记录、类别/风格分析、冲突提示”等产品结构思路；未复制代码或 UI。
- 两个独立项目都增加了版本化草案 Contract、固定测试夹具和本地检查脚本，作为未来融合前的边界验证。
- 将两个独立项目升级为可直接打开的静态演示网站：持仓导入站支持演示 CSV、浏览器内解析、逐行状态和确认；市场分析站支持市场状态、观察项筛选、信号原因和证据限制展开。
- 个人仓库开启 GitHub Pages 自动部署，两个站点分别发布到 `holdings-intake/` 和 `fund-market-analysis/` 路径；代码推送后由工作流重新构建静态站点。团队仓库当前计划不支持 Pages，因此只同步源码，不保留失败的部署工作流。

### 今日新增独立项目

| 项目 | 本次内容 | 当前状态 | 暂不连接 |
| --- | --- | --- | --- |
| `chenchen/holdings-intake/` | CSV 样例、字段校验、重复识别、日期/数字校验、数据质量状态、`holdings-intake.v0` Schema | 独立 MVP 骨架，检查通过 | Core Agent、Quant、Memory、Risk、主 UI |
| `chenchen/fund-market-analysis/` | 固定市场上下文、市场状态、4 个观察项、2 个信号、证据来源和限制条件、`fund-market-analysis.v0` Schema | 独立 MVP 骨架，检查通过 | Core Agent、Quant、Memory、Risk、主 UI |

这两个项目只放在各自的新文件夹中，不与现有投资产品或店主财务助手目录混合。未来如果要融合，只能通过双方确认后的版本化 Contract 和适配层接入，不能直接把实验逻辑塞回主链路。

### 今日网站交付

| 网站 | 入口 | 当前能力 |
| --- | --- | --- |
| 持仓导入台 | `holdings-intake/site/` | 选择或拖入 CSV、导入预览、逐行错误/提示、确认状态 |
| 基金市场雷达 | `fund-market-analysis/site/` | 市场状态卡、4 项观察、全部/待确认筛选、信号解释、证据与限制 |

两个网站都是前端演示，不接收真实账户、不调用实时行情，也不改变 Core Agent 主链路。个人仓库 GitHub Pages 地址为 `https://realchenchenluo.github.io/agent/holdings-intake/` 和 `https://realchenchenluo.github.io/agent/fund-market-analysis/`；团队仓库只保留源码。

### 当前主链路状态

| 阶段 | 当前状态 | 说明 |
| --- | --- | --- |
| 请求进入 | 已完成 | Backend 接收版本化 Contract 请求 |
| Session / Context | 已完成 | 支持 task、session 和演示数据模式 |
| Harness 编排 | 已完成 | 澄清、校验、诊断、候选、模拟、交接流程已串联 |
| Tools / Quant | 已接入现有结果 | Core Agent 调用现有工具结果，不复制计算逻辑 |
| Contract | 主流程已完成 | 已覆盖投资健康检查请求、响应、错误和 Risk Handoff |
| Risk 交接 | 已完成演示链路 | 生成证据引用，固定不允许执行 |
| 独立 Risk Consumer | 待接入 | 当前还没有独立 Risk 服务消费 Handoff |
| UI 对接 | 当前可用 | UI 已消费投资主流程返回结果；其他接口仍需继续统一 |

### 接口对齐重点

- Agent 发送：`contract_version`、`request_id`、`operation`、`context`、`input`。
- Backend 返回：`task_state`、`artifacts`、`tool_results`、`risk_handoff`。
- Risk 读取：`risk_handoff.evidence` 指向的持仓快照、健康报告、候选方案和模拟结果。
- 所有联调日志必须保留：`contract_version`、`request_id`、`task_id`、`session_id`。
- 旧的裸字段请求不能继续作为正式接口使用，会被拒绝为 `INVALID_CONTRACT`。

### 安全边界

- Core Agent 不重新计算 Quant。
- Core Agent 不修改 Memory 的 consent、范围、生命周期和清理规则。
- Core Agent 不绕过 Risk，不接受前端 approval 作为交易授权。
- 当前演示不执行真实交易，`execution_allowed` 固定为 `false`。

### 验证结果

- JavaScript 语法检查：通过。
- 自动化测试：50 项通过。
- HTTP Contract 测试：市场上下文请求返回 200，Risk Handoff 证据完整。
- 页面与静态资源 Smoke Test：启动当前版本服务后通过；首次执行因服务未启动无法连接，已复跑通过。
- 市场简报测试记录：见 `docs/market-brief-test-report-2026-10-08.md`。
- 团队仓库和个人仓库：代码状态已同步。

### 当前风险与阻塞

1. Contract 目前主要覆盖投资健康检查主流程，组合导入、诊断、策略生成和模拟等接口还需要继续版本化。
2. 独立 Risk Consumer 尚未接入，当前是生成并验证 Handoff，还没有外部 Risk 服务的真实消费链路。
3. 当前仍使用虚构演示数据，不能作为真实投资决策或交易系统。
4. 市场简报目前是固定参考夹具，不是实时行情或新闻服务；原油价格和地缘消息冲突只进入 Review。
5. 持仓导入项目目前只验证合成 CSV，尚未覆盖券商、银行、基金平台等真实文件格式，也没有处理真实用户敏感数据。
6. 市场分析项目目前只验证固定样例，尚未接入实时数据、基金公告和新闻服务，不能把市场状态当作收益预测或直接推荐。
7. 网站目前是静态演示，GitHub Pages 只负责发布前端文件；后续若接入真实数据，仍需单独设计认证、隐私、数据来源和服务端权限。

### 下一步

- 与 Risk 确认 Handoff 的消费字段、审核状态和回写方式。
- 与 Quant 确认只消费现有计算结果，不在 Core Agent 增加重复计算。
- 与 Memory 确认 Core Agent 只调用既有 Memory 接口，不修改授权和生命周期规则。
- 为剩余投资接口补充版本化 Contract 和错误信封。
- 与 UI 对齐主流程字段，确保页面不依赖未声明的内部字段。
- 与 Research / Data 确认真实市场数据接入时的来源、时间窗口、可信度和刷新协议。
- 在独立持仓项目中补充预览页、逐行错误报告和用户确认状态，仍保持与主产品隔离。
- 在独立市场分析项目中补充数据新鲜度、来源可信度、分类比较和冲突回顾，仍保持不生成直接买卖指令。
- 待产品方向确认后，再设计两个独立项目与主链路的适配层和融合验收清单。

## 后续日期模板

复制下面的模板，追加到本文档顶部或最新日期之后，保留所有历史记录：

```markdown
## YYYY-MM-DD

### 今日结论

一句话说明主链路推进到了哪里。

### 今日完成

- 

### 当前主链路状态

| 阶段 | 当前状态 | 说明 |
| --- | --- | --- |
| 请求进入 |  |  |
| Session / Context |  |  |
| Harness 编排 |  |  |
| Tools / Quant |  |  |
| Contract |  |  |
| Risk 交接 |  |  |
| UI 对接 |  |  |

### 接口对齐重点

- 

### 安全边界

- 未重新计算 Quant：是 / 否，说明：
- 未修改 Memory 规则：是 / 否，说明：
- 未绕过 Risk：是 / 否，说明：

### 验证结果

- 

### 当前风险与阻塞

1. 

### 下一步

- 
```

