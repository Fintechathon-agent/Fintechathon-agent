# Personal AI Fund Manager · Python 实现（模块 2 + 3）

本目录是 Personal AI Fund Manager 的 Python 参考实现，负责人 **qiqi**，承担团队分工中的
**模块 2（Agent Core & Memory）** 与 **模块 3（Financial Tools）**。
模块 1/4/5 在本目录内也有可运行的参考实现，用于打通端到端链路与集成验证，
**不代表这些模块的正式归属**——团队已有对应分工（见根 `AGENTS.md` 与各模块负责人目录）。

## 目录结构

```
qiqi/
├─ contracts/types.py              # 跨模块数据契约（含 Memory 五层定义）
├─ agent/
│   ├─ core/                       # 模块 2：Session / Context / State / Memory / Loop
│   │   ├─ memory.py               #   Hindsight 记忆（见下）
│   │   ├─ loop.py                 #   Agent Run Loop（含风控闸门接入点）
│   │   ├─ context.py              #   Context 组装
│   │   ├─ session.py / state.py   #   会话与状态机
│   │   └─ retry.py                #   重试策略
│   ├─ tools/                      # 模块 3：Financial Tools
│   │   ├─ market.py               #   行情（akshare，缺失自动降级 mock）
│   │   ├─ news.py                 #   新闻与舆情
│   │   ├─ portfolio.py            #   组合分析
│   │   ├─ backtest.py             #   回测
│   │   ├─ paper_trade.py          #   纸交易（不真实下单）
│   │   ├─ whatif.py               #   情景推演
│   │   ├─ financial_llm.py        #   金融场景 LLM prompts
│   │   └─ memory_tools.py         #   MCP 风格记忆工具
│   ├─ risk/                       # 模块 4 参考实现：RiskEngine / RiskGate / Approval / Audit
│   └─ orchestrator/               # 模块 1 参考实现：任务编排
├─ web/                            # 模块 5 参考实现：Web 用户端（模块5 负责人另有其人）
├─ brief/                          # 每日市场简报：采集 → 核验 → 发布 → 记忆导入
├─ docs/审计报告_*.md               # 数据标准化与 Memory 治理审计报告
└─ requirements.txt                # 实测依赖版本（Python 3.10 / Windows）
```

## 快速开始

```bash
pip install -r requirements.txt
cd qiqi                                        # 必须在 qiqi/ 下运行（contracts 以相对路径导入）
python web/launch.py                           # Web 用户端（无 LLM Key 时自动用规则引擎）
python web/app.py --port 8765                  # 或只起服务
```

数据落盘位置由 `config.fund.yaml` 的 `paths` 决定（默认项目内相对路径 `data/`）。
运行产物（记忆、审批、纸交易、审计日志）均在 `data/` 下，已在 `.gitignore` 排除。

## 记忆系统（模块 2 核心）

`agent/core/memory.py` 实现 Hindsight 记忆，**五层**：

| 层 | 语义 | 写入方 |
|---|---|---|
| `USER` | 用户明确提供或确认的偏好、约束与授权 | `save_user_profile()`；`confirmed_by_user` 区分「用户确认」与「系统默认」 |
| `FACT` | 可追溯来源的外部事实（组合占比、日报行情/利率/财报） | 组合快照、`brief/ingest_to_memory.py` |
| `EXPERIENCE` | 推荐、审批结果与复盘 | DecisionMaker（`save_recommendation` / `update_feedback`） |
| `OBSERVATION` | 风险警告与集中度判断 | RiskEngine 接入点（`loop.py`） |
| `MENTAL_MODEL` | 由观察自动提炼的规则，跨日期证据累积才升版本 | `reflect()` |

机制：置信度演化（跨天证据才算增量）、RRF 检索（关键词候选闸门 + 置信度/时效性融合）、
自动 Reflect（同一 `observation_type + symbols` 跨 ≥3 个日期触发）。

> `confidence` 语义：**启发式一致性评分，不是统计概率**，当前未经校准；
> 下游展示（Web/LLM context）不应将其解释为胜率或收益概率。

## 与团队契约的集成：市场简报 → `market_context`

团队在 `chenchen/contracts/investment-agent.v1.schema.json` 冻结了
`MarketBriefInput` / `MarketObservation` / `MarketSignal` / `SourceCheck`。
本目录的 `brief/export_team_market_context.py` 把每日简报采集产物导出为该格式：

```bash
python brief/export_team_market_context.py --date 2026-10-08
# → brief/out/team_market_context_2026-10-08.json
```

**已核对的兼容性（2026-10-08，与团队手工夹具逐字段比对）**：

| 项 | 结果 |
|---|---|
| `market[]` 14 项（asset_id / name / latest / change_pct / data_time / source_status） | ✅ 14/14 一致（含 `previous_value` 仅 UST30Y 有值，符合 Schema 可选定义） |
| `source_checks` | ✅ 3 项一致 |
| `change_pct` 单位语义 | ✅ 4.15 表示 4.15%，与风控文档 §3.2 的单位约定一致 |
| `signals` | ⚠️ 自动导出仅含机械判定（ABNORMAL_MOVE，阈值可配）；`PRICE_NEWS_CONFLICT` / `RATE_SENSITIVITY` / `DISCLOSURE_PACE` 等叙述型信号需 Research 层补充 |
| `data_mode` | ❌ **契约阻塞**：Schema 将该字段 `const` 为 `"REFERENCE_FIXTURE"`。自动采集的数据标 `REFERENCE_FIXTURE` 等于伪造来源（违反项目原则），标 `AUTO_BRIEF` 则不通过校验。**需团队决定**：放宽为 enum（如 `REFERENCE_FIXTURE | AUTO_BRIEF`）或另立契约版本。 |

另外两项元数据按语义区分（非缺陷）：`source_reference` 指向自动采集 JSON 而非 PDF；
`published_at` 从简报页脚「生成时间」解析（示例值与团队夹具一致）。

`market_context` 的消费边界沿用团队契约：只用于异常标记与 Risk 复核，
不覆盖 Quant 的组合收益/回撤/相关性计算，价格与消息冲突只产出 `REVIEW_REQUIRED`。

## 数据契约与核验

```bash
python brief/verify_contract.py --all          # 校验 out/market_*.json（必备字段/时区/来源）
python brief/ingest_to_memory.py --date 2026-10-08 --dry-run
python brief/ingest_to_memory.py --date 2026-10-08    # 日报 → FACT 层（幂等）
```

- `schema_version` / `observed_at`（ISO 8601 带时区）由采集脚本自 2026-10-08 起写入；
- 更早存档（10-07）缺新字段，`verify_contract.py --all` 对其宽松处理（契约升级前存档）。

## 本轮（2026-10-09）修复摘要

审计报告见 `docs/审计报告_数据标准化与Memory治理_2026-10-09.md`。已修：

| 问题 | 修复 | 位置 |
|---|---|---|
| 日报数据与 Memory 零交叉 | 新增导入器（幂等、可 dry-run） | `brief/ingest_to_memory.py` |
| 无 User Memory 类别 | 新增 `MemoryLayer.USER` + `MemoryUser` + 读写接口 | `contracts/types.py`、`agent/core/memory.py` |
| 契约缺 `observed_at`/`schema_version` | 采集补字段 + 回填 10-08 存档 | `brief/collect_market_data.py` |
| 审批队列无法按用户过滤 | `list_pending` 过滤修复 + `ApprovalRequest.user_id` + 落盘补组合/风险摘要 | `agent/risk/approval.py` |
| `recall` 排序缺陷（零命中条目挤占结果） | 候选闸门 + 全未命中兜底 | `agent/core/memory.py` |
| 审计日志 `user_id` 误填证券代码 | 改取审批归属用户 | `agent/orchestrator/orchestrator.py` |
| 无依赖文件 / 无契约自检 | 新增 `requirements.txt` / `verify_contract.py` | 见上 |

回归：14 个关键模块导入、golden path（建议→闸门→审批队列→情景推演）、
既有记忆库读取、reflect 跨日升版/同日不涨，全部通过。

## 边界与不做

- 不真实下单：`paper_trade` 仅记录，`execution_allowed` 类字段恒为 false。
- 未经审批不执行：置信度低于阈值进入 `ApprovalManager` 队列，人工批准后才纸交易。
- mock 数据：`market_source: "mock"` 时行情为本地生成（`source` 字段标注），仅供开发演示。
- 本目录不包含：会议记录 Agent（历史遗留，在本地仓库未上传）、PRD 文档、运行产物 `data/`。
