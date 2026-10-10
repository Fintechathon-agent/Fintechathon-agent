# Personal AI Fund Manager — 持仓哨兵

> 从"告诉用户市场发生了什么"，升级为"告诉这个具体用户，现在应该关注什么、为什么，以及采取行动会发生什么"。

## 赛道定位：银行 AI 智能体 · 理财操作场景的深度覆盖

赛题为「银行 AI 智能体」，要求自然语言驱动，覆盖转账 / 账单 / 理财 / 卡片 / 订阅 / 跨场景联动六个场景。本项目选择**只把「理财操作」一个场景做深**，这是主动的选题而非能力所限：

- **理财是六场景中唯一"资产动账 + 红色强验证"的场景**——申购 / 赎回按赛题要求必须人脸 + 短信多因子认证，安全要求最高，恰好落在团队安全工程的积累（30% 评分权重）上；
- 理财决策是大模型最危险的失效模式（幻觉价格、超卖持仓、违规行业申购），确定性风控闸门正好卡在这个痛点上；
- **深度 > 广度**：一条「意图 → 诊断 → 建议 → 闸门 → 情景推演 → 强验证 → 纸交易 → 审计 → 记忆演化」的完整可信闭环，比六个场景的浅覆盖更能证明赛题核心要求——"在严格的安全框架内完成银行业务操作"。

赛题要求逐项映射、答辩口径与 200 字作品简介见 [docs/赛题对齐与答辩叙事.md](docs/赛题对齐与答辩叙事.md)。

## 用户端（Web Demo）

双击 **`启动用户端.cmd`** 即可（自动注入本机 LLM 凭据、选配置、开浏览器）。等价命令：

```bash
python web/launch.py                 # 推荐：注入密钥 + 自动打开浏览器
python web/app.py --port 8765        # 纯服务，默认 http://127.0.0.1:8765
python web/launch.py --no-key        # 强制规则决策引擎（无 key 也能完整演示）
```

零额外依赖：服务只用 Python 标准库 `http.server`，前端无 CDN、断网可用。

### 界面覆盖的功能

| 区域 | 内容 |
|---|---|
| 资产总览 | 总资产 / 当日涨跌 / 累计收益率 / 持仓结构，附风险提示 |
| 持仓明细 | 成本价、现价、市值、浮动盈亏、收益率（红涨绿跌） |
| 行业分布 | 环形图 + 占比条，单一行业 >30% 高亮告警 |
| 组合体检 | 一键触发完整链路，9 步流程实时点亮；产出建议卡（动作/数量/价格/理由/依据/风险影响/备选方案/置信度） |
| 风控闸门 | 准入检查逐项展示；未通过的建议被拦截，既不自动执行也不占用审批队列 |
| 情景推演 | 执行后的指标前后对比（集中度、超限行业数、风险评分、VaR、现金），附不确定性说明 |
| 待确认事项 | 红色权限建议在此确认；含操作详情确认页 + 多因子强验证（短信 + 人脸，演示为 Mock） |
| 审计时间线 | 每一步操作留痕，可按日期展开原始记录（默认展示最近 12 条，可展开更早） |
| 四层记忆 | fact / experience / observation / mental_model 可视化，含置信度、证据天数、版本演化与建议反馈 |
| 纸交易记录 | 模拟成交回执（含滑点与手续费），全程不连接真实账户 |
| 今日简报 | 文本版持仓简报（P0 功能，TTS 未接） |
| 权限分级 | 绿/黄/红三档映射表，对齐赛题要求 |

### HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 用户、组合、健康报告、资讯、简报、待确认、权限矩阵 |
| POST | `/api/review` | 执行一次组合体检，返回建议 + 闸门结果 + 情景推演 |
| GET | `/api/approvals` | 待确认队列（同笔操作自动去重，只保留最新一条） |
| POST | `/api/decide` | 用户裁决：确认执行（红色权限需强验证）或拒绝 |
| GET | `/api/audit` | 审计时间线 |
| GET | `/api/memory` | 四层记忆 + 建议历史 |
| GET | `/api/trades` | 纸交易记录 |
| GET | `/api/brief` | 今日简报 |
| POST | `/api/reset` | 重置演示状态（清空审批与纸交易，长期记忆保留） |

### 演示路径建议

1. 打开页面 → 看资产总览与行业分布（白酒 50% 触发集中度告警）
2. 点「开始组合体检」→ 9 步流程跑完，看风控闸门各检查项 + 情景推演的指标前后对比
3. 点「确认执行」→ 阅读操作详情 → 勾选确认 → 强验证（任意 6 位数字 + 人脸识别）
4. 看执行回执、审计时间线、纸交易记录、四层记忆的新增条目
5. 再体检一次并点「拒绝」→ 到四层记忆看经验层如何记录这次拒绝及其置信度变化

> 演示环境声明：不连接真实账户，不执行真实资金交易；行情与情景数据均为演示数据，不构成收益承诺。

> 实现说明：用户端只做展示与确认闸门，决策、风控、推演全部复用 `agent/` 下各模块；
> 行情来源改为「与演示组合同源自洽」的快照，避免 mock 随机价让体检数字在多次运行间漂移。

---

## 产品演示


```
============================================================
  Personal AI Fund Manager — Portfolio Health Check Demo
============================================================

👤 用户：演示用户 | 风险偏好：稳健
💼 组合：总市值 308,160 元 | 现金 50,000 元 | 5 只持仓

📊 组合健康报告
  盈利持仓：2 只 | 亏损持仓：3 只
  ⚠️  行业集中度过高：银行 占比 86%
  ⚠️  亏损持仓居多（3只），注意止损

💡 组合共5只持仓，盈利2只、亏损3只，总市值308160.00元，建议分散银行行业持仓。

📋 下一步建议：
  1. 建议检视亏损持仓，考虑止损或加仓摊薄成本
  2. 建议分散银行行业持仓

🤖 Agent 响应
  建议：卖出 000001 平安银行 1500股 @48.7
  理由：银行行业集中度 86%，超过 40% 阈值
  置信度：78%（>70%，自动执行纸交易）
  审批状态：无需人工审批，已执行纸交易
```

---

## 系统架构

```
                    ┌─────────────────────────────────────┐
                    │            用户请求                  │
                    │   "检查我的持仓健康状况"              │
                    └──────────────┬──────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  Orchestrator（任务编排器）           │
                    │  · 组装 Context                      │
                    │  · 汇聚各模块响应                     │
                    │  · 返回统一格式 AgentResponse         │
                    └──────────────┬──────────────────────┘
                                   ▼
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ AgentLoop     │      │ RiskEngine       │      │ DecisionMaker   │
│ 模块2：Core   │      │ 模块4：Safety    │      │ 模块3：Tools    │
│               │      │                  │      │                 │
│ · Session     │      │ · 风险边界检查   │      │ · LLM 决策      │
│ · Context     │◄────►│ · 禁止行业违规   │      │   （有key时）   │
│ · State       │      │ · 集中度超限    │      │ · 规则降级决策  │
│ · Memory      │      │ · VaR 估算      │      │   （无key时）   │
│ · Loop        │      └──────────────────┘      └────────┬────────┘
│ · Retry       │                                           │
└───────┬───────┘                                           │
        │                                                   │
        ▼                                                   ▼
┌───────────────┐                              ┌─────────────────┐
│ Financial     │                              │ PaperTrading    │
│ Tools 模块3   │                              │ 执行记录         │
│               │                              │                 │
│ · market.py  │◄──► Orchestrator              │ 记录买卖操作     │
│ · news.py    │                              │ 不动真实账户     │
│ · portfolio  │                              └─────────────────┘
│ · backtest   │
│ · paper_trade│
└───────────────┘
```

---

## Hindsight 四层记忆（模块2 核心）

记忆系统从"流水账"升级为**会演化的认知结构**，参考 Meta Hindsight 论文思路，
并借鉴三个开源实现（ams-poc 的置信度演化 + RRF 检索、jedisos 的 MCP 工具形态、
mindOS 的本地优先持久化）。

> 2026-10-09 新增 **User Memory 层**（第五层）：用户明确提供/确认的偏好、约束与授权。
> 与其余四层的区别是"来源"——不是观察来的，而是用户声明的；配置默认值写入时标记
> `confirmed_by_user=false`（系统假设），用户显式确认才置 `true`。
> 读写：`store.save_user_profile(user_id, profile, confirmed_by_user=True)` /
> `store.load_user_profile(user_id)`。**授权类条目才代表交易许可，偏好不构成授权。**

### 四层结构

```
┌─────────────────────────────────────────────────────────────┐
│  User Memory    用户记忆   风险偏好/期限/止损/禁止行业/授权    │
│  ↑ 用户声明（confirmed_by_user 区分"已确认"与"系统默认"）      │
├─────────────────────────────────────────────────────────────┤
│  Mental Models  心智模型   "银行占比>40%应减仓"               │
│  ↑ 由观察自动提炼（同一信号跨 ≥3 个日期出现）                  │
├─────────────────────────────────────────────────────────────┤
│  Observations   观察       风险警告、集中度超标判断            │
│  ↑ 每次体检由 RiskEngine 写入                                 │
├─────────────────────────────────────────────────────────────┤
│  Experiences    经验       推荐记录、审批结果、盈亏复盘         │
│  ↑ 每次决策由 DecisionMaker 写入                              │
├─────────────────────────────────────────────────────────────┤
│  World Facts    世界事实   持仓行业占比、日报行情/利率/财报     │
│  ↑ 组合快照 + `brief/ingest_to_memory.py`（日报导入）          │
└─────────────────────────────────────────────────────────────┘
```

### 核心机制

**置信度演化**：新证据支持 → +0.10；矛盾证据 → −0.20；**跨天**重复出现才算新证据，
同一天反复体检同一组合不会虚高置信度。

**RRF 混合检索**：`memory_recall()` 融合三路排名——
关键词命中、置信度、时效性，用 Reciprocal Rank Fusion 合成最终排序。
检索先按关键词（含 tags）筛出候选，再在这批候选内排名——避免零命中条目
仅凭置信度/时效性挤占结果（日报事实逐日累积后尤其重要）。全部未命中时
退回全集，保证"问不到"返回最近/最可信记忆而非空列表。

**自动 Reflect**：`memory_reflect()` 扫描观察层，同一 `observation_type + symbols`
聚类的证据累计到 3 条时，自动生成心智模型（v1）；后续有新证据才升版本，
只重复无新增时保持版本不变。

### MCP 风格接口

```python
from agent.tools.memory_tools import memory_retain, memory_recall, memory_reflect

memory_retain("u1", "observation", "银行占比86%超标", observation_type="sector_concentration")
memory_recall("u1", "银行 集中度", top_k=3)   # RRF 排序返回
memory_reflect("u1")                          # 提炼/更新心智模型
```

### 数据落盘

```
data/memory/<user_id>/
├── mem_fact.json           # 世界事实（持有期验证时间）
├── mem_experience.json     # 经验（含 outcome / 实际收益）
├── mem_observation.json    # 观察（含 reinforce_count）
├── mem_mental_model.json   # 心智模型（含 version / 成功率）
├── recommendations.json    # 推荐历史（兼容旧接口）
└── session_*.json          # 会话记录
```

---

```
agent/
├── core/                   # 模块2：Agent Core & Memory
│   ├── session.py          # 会话生命周期（并发安全）
│   ├── context.py         # Context 构造器
│   ├── state.py           # Phase 状态机
│   ├── memory.py          # Hindsight 四层记忆（置信度演化 + RRF 检索）
│   ├── loop.py            # Agent 运行循环（Harness）
│   └── retry.py           # 指数退避重试
│
├── tools/                  # 模块3：Financial Tools & Data
│   ├── market.py          # 行情（akshare 封装 + mock）
│   ├── news.py            # 新闻舆情
│   ├── portfolio.py       # 持仓健康分析
│   ├── backtest.py        # 回测引擎
│   ├── paper_trade.py     # 纸交易执行
│   ├── whatif.py          # 情景推演 + 反事实备选扫描
│   ├── memory_tools.py    # MCP 风格记忆工具（retain/recall/reflect）
│   └── financial_llm.py   # 金融 LLM prompts
│
├── risk/                   # 模块4：Risk / Safety / Eval
│   ├── engine.py          # 风险引擎（状态评估）
│   ├── gate.py            # 风控闸门（动作准入，fail-closed）
│   ├── audit.py           # 审计日志
│   └── approval.py        # Human Approval 审批队列
│
├── orchestrator/
│   └── orchestrator.py    # 模块1：Orchestrator（任务编排）
│
├── config.py              # 原有会议记录配置
├── config_fund.py         # 金融 Agent 配置加载
└── llm.py                # DeepSeek HTTP 客户端

contracts/
└── types.py               # 跨模块 Contract（所有模块必须遵守）

config.fund.yaml           # 金融 Agent 配置（LLM / 行情源 / 风控）
demo/
└── __init__.py           # Portfolio Health Check 演示入口
```

---

## 情景推演与风控闸门

产品主张的最后一环是"**采取行动会发生什么**"——这一环由推演引擎和闸门共同落地：

```
Agent 提出建议
      │
      ▼
┌─────────────────────────────────────────────┐
│ WhatIfEngine  把建议应用到组合副本，重算风险  │
│  · 最大行业集中度 / 超限行业数 / 风险评分      │
│  · VaR、持仓数、现金比例                      │
│  · 无法执行时明确说明原因，不猜测              │
└──────────────┬──────────────────────────────┘
               │ 若主推方案净效果为负
               ▼
┌─────────────────────────────────────────────┐
│ 反事实扫描  遍历每只持仓 × 不同减持力度        │
│  按（净改善项数 → 风险降幅）排序，给出更优解    │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│ RiskGate   LLM proposes, Python disposes     │
│  7 项确定性检查，任一不过即拦截                │
│  任何检查抛异常 → fail-closed 保守拦截         │
└─────────────────────────────────────────────┘
```

### 推演示例（真实输出）

```
🔮 情景推演：卖出 000001 2500股 @10.31
  ⚠️  最大行业集中度：50.0% → 55.5%（↑5.5）
  ✅ 超限行业数（>30%）：2个 → 1个（↓1）
  ✅ 风险评分：70.0分 → 61.2分（↓8.8）
  ➖ VaR(95%)：2.6% → 持平
  ✅ 现金余额：50,000元 → 75,775元（↑25,775）（参考）
  结论：执行后 2 项改善、1 项恶化、2 项无变化，风险下降（评分 -8.8 分），建议执行。
```

指标分两类：计入结论的（集中度、风险评分、VaR、持仓数）与仅展示的参考项（现金比例、余额），
避免"现金变多"这类中性变化被误算成改善。无变化的指标单独计数，不包装成正面结论。

### 风控闸门 7 项检查

| 检查项 | 拦截场景 |
|---|---|
| 操作类型有效性 | 未知操作类型、卖出未指定标的 |
| 交易量有效性 | 数量非正、非整数股 |
| 价格合理性 | 建议价偏离参照价 >20%（**行情缺失时用持仓记录价兜底**） |
| 置信度下限 | 低于 35% 的建议直接打回，不占用审批队列 |
| 禁止行业 | 买入用户禁止行业的标的（卖出减仓放行） |
| 持仓/资金充足性 | 卖超持仓、买入资金不足、卖出未持有标的 |
| 集中度上限 | 买入后单标的 >50% 或单行业 >50% |

**fail-closed**：任何检查项自身抛异常时按"不通过"处理。行情源挂掉、数据格式异常，
都不会导致闸门静默放行——这是金融 Agent 最基本的防御姿态。

### 数据一致性修正

本次同时修复了三个会让演示站不住脚的问题：

- **mock 行情随机价**：原实现用 `md5(symbol)` 生成价格，把 demo 手工设定的成本价覆盖成
  48.7 元的"平安银行"。改为锚定真实量级（平安银行 10.5、茅台 1650），演示叙事自洽。
- **整手取整产生 0 股**：`int(50 * 0.3 / 100) * 100 = 0`，茅台这类高价股持仓不足一手时
  会产出"卖出 0 股"的无效建议。改为 `round_lot()`，不足一手按整仓处理。
- **总市值未重算**：行情更新持仓价后总市值仍是旧值，导致行业占比、现金比例全部失真，
  推演的前后对比也就失去意义。

---

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

> 版本清单见 `requirements.txt`（2026-10-09 本机实测版本，审计前仓库无依赖文件）。
> `akshare` 为可选依赖。不装则自动用模拟数据，确保开发测试不阻塞。

### 1.5 数据契约与日报接入（2026-10-09 新增）

日报数据与 Memory 之间的链路已打通（详见 `docs/审计报告_数据标准化与Memory治理_2026-10-09.md`）：

```bash
# 校验日报数据结构（必备字段 / 时间语义 / 来源可追溯）
python brief/verify_contract.py --all

# 把日报数据导入 Hindsight 记忆（默认：行情 + 美债官方 + 业绩预告）
python brief/ingest_to_memory.py --date 2026-10-08 --dry-run   # 先预览
python brief/ingest_to_memory.py --date 2026-10-08             # 执行

# 含重点快讯（earnings/macro/geopolitics，默认关闭——转载源，按需开启）
python brief/ingest_to_memory.py --date 2026-10-08 --include-news
```

导入后日报数据成为 fact 层可检索记忆（`recall("国债 收益率")` 命中财政部官方数据）。
幂等：重复导入同一日期只做去重增强，不产生重复记录。

### 2. 配置（可选，有 DeepSeek key 时）

```bash
# 复制配置文件
copy config.fund.yaml config.fund.local.yaml

# 编辑 config.fund.local.yaml，填入你的 API key
# 或设置环境变量：set DEEPSEEK_API_KEY=sk-xxxx
```

### 3. 运行演示

用户端（网页界面，推荐）：

```bash
python web/launch.py            # 自动注入凭据 + 打开浏览器
python web/app.py --port 8765   # 或只起服务，浏览器访问 http://127.0.0.1:8765
```

命令行端：

```bash
python demo\__init__.py
```

### 4. 接入 LLM（有 key 时）

```python
from agent.orchestrator import build_orchestrator
from agent.llm import LLMClient
from agent.config_fund import load_fund_config

cfg = load_fund_config()
llm = LLMClient(cfg.llm)
orch = build_orchestrator(llm_client=llm)

response = orch.handle_review_request(user_profile, portfolio)
print(response.recommendation)
```

---

## 决策逻辑

### 有 LLM Key

```
输入：用户画像 + 持仓 + 市场行情 + 新闻 + 历史记忆
       ↓
FinancialLLM.make_decision()
       ↓
输出：Recommendation(action, symbol, quantity, reason, evidence, confidence)
```

### 无 LLM Key（当前 Demo 默认）

| 触发条件 | 动作 | 置信度 |
|---|---|---|
| 某持仓亏损超过用户红线 | 卖出50% | 82% |
| 单一行业占比 >40% | 减仓30% | 78% |
| 亏损持仓数过半 | 止损最差持仓 | 72% |
| 现金比例 >50% | 少量加仓优选持仓 | 65% |
| 无明显异常 | 持有 | 90% |

置信度 <70% → 进入 Human Approval 审批队列

---

## Golden Path（完整流程）

```
用户建立个人财务画像并导入投资组合
  ↓
向 Personal AI Fund Manager 发起 Portfolio Review
  ↓
Orchestrator 加载用户 Context 与历史 Memory
  ↓
Financial Tools 获取市场、新闻和资产数据
  ↓
Portfolio Agent 分析个人资产配置
  ↓
Risk Engine 根据用户 Investment Constitution 检查风险边界
  ↓
Decision Manager 形成个性化调整方案
  ↓
系统展示 Recommendation、Reason、Evidence、Confidence 和 Risk
  ↓
用户进行 Human Approval（如需）
  ↓
系统执行 Paper Trading
  ↓
Portfolio 与长期 Memory 更新
```

---

## 配置说明（config.fund.yaml）

```yaml
llm:
  provider: "deepseek"           # 或 "openai-compatible"
  api_key: ""                    # 留空读环境变量 DEEPSEEK_API_KEY
  base_url: "https://api.deepseek.com"
  model: "deepseek-chat"
  temperature: 0.3               # 金融场景建议偏低

financial:
  market_source: "mock"          # akshare | tushare | mock
  news_source: "mock"            # akshare | mock

risk:
  approval_threshold: 0.70        # 置信度低于此值触发人工审批
```

---

## 团队分工（5 模块）

| 模块 | 负责方 | 核心职责 |
|------|--------|---------|
| 模块1：Orchestrator | 产品与系统架构部 | 任务编排、Context 组装、最终响应输出 |
| 模块2：Agent Core & Memory | **你（模块2+3）** | Session、Context、State、Memory、Loop |
| 模块3：Financial Tools | **你（模块2+3）** | 行情、新闻、Portfolio、Backtest、PaperTrading |
| 模块4：Risk / Safety / Eval | 安全风控与评测部 | 风险引擎、Human Approval、审计日志 |
| 模块5：Launcher / Demo | 产品交互与演示部 | Web UI、Agent 状态可视化、比赛 Demo |

---

## 参考项目

| 项目 | Stars | 特点 |
|------|-------|------|
| [PanWatch](https://github.com/TNT-Likely/PanWatch) | 1,410 | TradingAgents 多 Agent 架构，DeepSeek 集成 |
| [ai-stock-analyst](https://github.com/LiteObject/ai-stock-analyst) | — | 6 种专业 Agent 分工 |
| [RakshaQuant](https://github.com/HimanshuMohanty-Git24/RakshaQuant) | 50 | LangGraph 编排、Risk Guardrails、Paper Trading |
| [FinRL_DeepSeek](https://github.com/benstaf/FinRL_DeepSeek) | 331 | 风险敏感强化学习用于交易 Agent |
| [glassbench](https://github.com/davidalmeida90/glassbench) | 2 | Interactive Brokers 对接、回测可视化 |
| [ams-poc](https://github.com/dkd-dobberkau/ams-poc) | — | 4 层记忆 + 置信度追踪 + RRF 混合检索 |
| [jedisos](https://github.com/jedikim/jedisos) | — | LangGraph 编排 + Hindsight Memory MCP 工具 |
| [mindOS](https://github.com/idea-torx/mindOS) | — | SQLite 本地优先、FTS5 检索、时间事实链 |
| [astra-quant-agent](https://github.com/0xethanq/astra-quant-agent) | 262 | "LLM proposes, Python disposes" + fail-closed 风控管线 |
| [openInvest](https://github.com/longsizhuo/openInvest) | 85 | 信息隔离投委会 + 交叉质询 + 可审计决策链 |
| [helm-agents](https://github.com/QuantiaAI/helm-agents) | 91 | 13 位分析师多空辩论 + 风控压测 + 实时可观察 |
| [finboard](https://github.com/openara-ai/finboard) | 1 | 基金穿透分析；拆不开的明确标记未知而非猜测 |

---

## 参赛信息

- **赛题**：银行 AI 智能体 —— 聚焦「理财操作」场景的深度覆盖
- **评分维度**：任务完成率（40%）、安全性（30%）、创新性（30%）
- **核心交付**：理财操作可信闭环：意图 → 诊断 → 建议 → 风控闸门 → 情景推演 → 强验证 → 纸交易 → 审计 → 记忆演化
- **选题逻辑**：六场景中理财是唯一"资产动账 + 红色强验证"的场景，安全纵深在此不是加分项而是生存项；详见 [docs/赛题对齐与答辩叙事.md](docs/赛题对齐与答辩叙事.md)
