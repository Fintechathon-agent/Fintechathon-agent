# Finance Lab — 金融 AI 安全任务台

> 把自然语言银行请求拆成可检查、可确认、可回放的安全任务。理财分析是深度业务路径，不再是产品总品牌。

## 赛道定位：金融 AI 安全任务台 · 六场景全覆盖

赛题为「银行 AI 智能体」，要求自然语言驱动，覆盖转账 / 账单 / 理财 / 卡片 / 订阅 / 跨场景联动六个场景（至少 3 个，鼓励全覆盖）。本项目**六场景全覆盖**：

- **理财操作（场景 3）= 深度业务路径**：意图 → 诊断 → 建议 → 风控闸门 → 情景推演 → 强验证 → 纸交易 → 审计 → 记忆演化的完整可信闭环。它是安全能力的深水区，但不再代表整个产品；
- **其余五场景复用同一安全体系**：智能转账（黄/红分级 + 收款人/余额/限额确定性闸门 + AA 拆分 + 定时转账）、账单分析（绿，分类统计 + 异常识别 + 月/年报）、卡片管理（查询绿 / 锁卡与额度黄 / 挂失红强验证）、订阅代扣（自动识别 + 续费提醒 + 取消黄确认）、跨场景联动（生日 → 锁定活期 + 生日前 2 天订花订蛋糕的计划 DAG + 记忆写入）；
- **统一防线**：注入检测 → 闭集场景路由 → 场景 DAG → 确定性域闸门（fail-closed）→ 三级权限（绿自动 / 黄确认 / 红强验证）→ 审计 → 熔断。

设计方案见 [docs/六场景全覆盖设计方案_2026-10-11.md](docs/六场景全覆盖设计方案_2026-10-11.md)，赛题逐项映射与答辩口径见 [docs/赛题对齐与答辩叙事.md](docs/赛题对齐与答辩叙事.md)。

## 用户端（Web Demo）

双击 **`启动用户端.cmd`** 即可打开本地演示（只使用当前进程显式提供的 LLM 环境变量，不读取本机凭据文件）。等价命令：

```bash
python web/launch.py                 # 使用环境变量中的密钥（可选）+ 自动打开浏览器
python web/app.py --port 8765        # 纯服务，默认 http://127.0.0.1:8765
python web/launch.py --no-key        # 强制规则决策引擎（无 key 也能完整演示）
```

验收可视化看板：服务启动后访问 `http://127.0.0.1:8765/evidence`。这里集中展示赛题要求、代码/测试证据、演示边界、差距和明早检查路径；`/compare` 仍是可交互的安全任务台。

看板预览图：[artifacts/evidence-board-preview.png](artifacts/evidence-board-preview.png)。

前端无 CDN、断网可用；后端依赖见 `requirements.txt`（Web 服务本身使用标准库 `http.server`）。

### 界面覆盖的功能

| 区域 | 内容 |
|---|---|
| 六场景统一入口 | 顶部场景卡片（转账/账单/理财/卡片/订阅/跨场景联动）+ 一句话发起：自动路由、场景 DAG、三级权限与结果面板 |
| 新手零输入入口 | 「看本月账单」「找异常扣款」「我不知道去哪里看流水」三项快捷操作；点击场景卡直接执行示例，不再要求先学会输入指令 |
| 智能转账 | 按人名/手机号/备注转账、定时转账、AA 拆分收款；收款人/余额/限额确定性闸门；日累计 ≤1000 黄、>1000 红强验证；「查一下我的余额」绿色自动回答 |
| 账单分析 | 消费分类统计、异常交易识别（大额/境外/深夜/重复扣款/新商户）、月度/年度报告（绿，自动）；可按手机银行/微信支付/支付宝向导找到流水，并在浏览器内读取 CSV / TXT 后显示笔数、合计和分类 |
| 卡片管理 | 卡列表/单卡查询（绿）、额度与限额调整/锁卡解锁（黄确认）、挂失（红强验证）；未指明卡时列出候选追问 |
| 订阅/代扣 | 同商户同金额跨 3 个月自动识别订阅、7 天续费提醒、一键取消（黄确认）；只说「取消自动续费」会追问取消哪一个 |
| 跨场景联动 | 「我爱人生日」→ 生日记忆写入 + 锁定活期（待确认）+ 生日前 2 天订花订蛋糕计划任务（Mock 标注） |
| 资产总览 | 总资产 / 当日涨跌 / 累计收益率 / 持仓结构，附风险提示 |
| 持仓明细 | 成本价、现价、市值、浮动盈亏、收益率（红涨绿跌） |
| 行业分布 | 环形图 + 占比条，单一行业 >30% 高亮告警 |
| 自然语言与 DAG | 输入口语请求后解析意图/标的/比例；按诊断或执行意图生成不同 DAG，展示真实节点状态与依赖 |
| 理财深度分析 | 产出建议卡（动作/数量/价格/理由/依据/风险影响/备选方案/置信度）；信息不足时只追问必要项 |
| 风控闸门 | 准入检查逐项展示；未通过的建议被拦截，既不自动执行也不占用审批队列 |
| 情景推演 | 执行后的指标前后对比（集中度、超限行业数、风险评分、VaR、现金），附不确定性说明 |
| 待确认事项 | 红色权限建议在此确认；含操作详情确认页 + 多因子强验证（短信 + 人脸，演示为 Mock） |
| 审计时间线 | 每一步操作留痕，可按日期展开原始记录（默认展示最近 12 条，可展开更早） |
| 四层记忆 | fact / experience / observation / mental_model 可视化，含置信度、证据天数、版本演化与建议反馈 |
| 纸交易记录 | 模拟成交回执（含滑点与手续费），全程不连接真实账户 |
| 今日简报 | 文本版持仓简报（P0 功能，TTS 未接） |
| 权限分级 | 绿/黄/红三档映射表，对齐赛题要求 |
| 异常熔断 | 闸门拦截、记忆门卫拒绝或强验证失败累计 3 次后锁定资金执行；查询保留，人工确认后恢复 |

### HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 用户、组合、健康报告、资讯、简报、待确认、权限矩阵 |
| POST | `/api/review` | 接收自然语言，返回意图、任务 DAG、建议、闸门与情景推演 |
| GET | `/api/scenarios/boot` | 六场景总览：场景卡、卡片、订阅、通讯录、余额、三级权限矩阵 |
| POST | `/api/scenarios/run` | 六场景统一入口：自然语言 → 场景路由 → 结果/待确认（理财请求自动转交深度分析路径） |
| POST | `/api/scenarios/confirm` | 确认黄/红待办（红需短信+人脸 Mock 强验证，失败计入熔断） |
| POST | `/api/scenarios/cancel` | 拒绝黄/红待办 |
| GET | `/api/scenarios/pending` | 六场景待确认队列 |
| GET | `/api/audit` | 审计时间线 |
| GET | `/api/memory` | 四层记忆 + 建议历史 |
| GET | `/api/trades` | 纸交易记录 |
| GET | `/api/brief` | 今日简报 |
| POST | `/api/reset` | 重置演示状态（清空审批与纸交易，长期记忆保留） |
| POST | `/api/breaker/reset` | 人工确认异常原因后恢复资金执行链路 |

### 零输入使用路径

第一次使用的人不需要记住任何指令：

1. 点「看本月账单」，页面直接返回本月支出、分类和异常标记；
2. 点「我不知道去哪里看流水」，选择手机银行、微信支付或支付宝，页面显示对应的打开路径；
3. 在对应 App 导出 CSV / TXT，回到页面点「选择账单文件」，浏览器会立即显示读取笔数、合计支出和主要分类；
4. 需要转账、挂失或取消订阅时，直接点场景卡，系统自动填入示例并执行，不需要再点第二次输入框；
5. 所有需要资金确认的动作仍会明确展示下一步，查询类动作直接给结果。

账单文件只在当前浏览器内读取，当前版本不会自动登录或进入银行、微信、支付宝，也不会把密码交给产品；演示服务仍使用固定数据，不发生真实扣款。

### 演示路径建议

1. 打开页面 → 顶部六场景入口输入「这个月账单分析」或「帮我看看这个月花了多少钱」→ 分类统计 + 异常交易标记（绿，自动）；「查一下我的余额」→ 余额 + 日累计
2. 「给陈大黄转500元备注聚餐」→ 黄色待确认 → 确认执行 → 审计留痕；「给林粹转5000」→ 红色 → 短信+人脸 Mock
3. 「取消健身房会员」→ 黄色确认 → 订阅状态变更；「尾号8888的卡挂失」→ 红色强验证 → 锁卡；「帮我看看我的银行卡」→ 三卡列表（绿）
4. 「我爱人10月25日生日，生日前2天订花和蛋糕，锁定1000元活期」→ 六节点 DAG + 记忆写入 + 计划任务
5. 右侧理财深度分析：输入「平安银行卖出 30%」或「是不是该跑了，帮我看看」
6. 点「发起体检」→ 看结构化意图与本轮实际 DAG，再看风控闸门 + 情景推演
7. 点「确认执行」→ 阅读操作详情 → 勾选确认 → 强验证（任意 6 位数字 + 人脸识别）
8. 看执行回执、审计时间线、纸交易记录、四层记忆的新增条目
9. 再体检一次并点「拒绝」→ 到四层记忆看经验层如何记录这次拒绝及其置信度变化
10. 连续 3 次强验证失败 → 熔断锁定 → 资金操作暂停、查询可用 → 人工确认恢复

> 演示环境声明：不连接真实账户，不执行真实资金交易；行情与情景数据均为演示数据，不构成收益承诺。

> 实现说明：用户端只做展示与确认闸门，决策、风控、推演全部复用 `agent/` 下各模块；
> 行情来源改为「与演示组合同源自洽」的快照，避免 mock 随机价让体检数字在多次运行间漂移。

---

## 产品演示


```
============================================================
  Finance Lab — Financial AI Safety Task Console Demo
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
  用户请求：平安银行卖出 30%
  解析：理财操作 / 标的 000001 / 比例 30%
  建议：卖出 000001 平安银行 1500 股 @10.5
  审批状态：红色权限，等待用户确认与强验证；不会自动交易
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
                    │  Intent Router → DAG Planner         │
                    │  · 口语意图/槽位/必要追问             │
                    │  · 动态节点与依赖、可审计状态          │
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
│ · Circuit     │                                           │
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

### 可复跑验证

```bash
python -m unittest discover -s tests -v
python -m evals.run_safety_eval
```

当前结果：118 个本地回归测试通过；自然语言入口安全集 54/54 攻击拦截（100%），20 条正常金融表达误伤 0 条（0%）。该评测是本地规则集结果，不代表对所有未知攻击的泛化保证。

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
└── __init__.py           # Finance Lab 用户端演示入口
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
python web/launch.py            # 使用环境变量中的密钥（可选）+ 打开浏览器
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
向 Finance Lab 发起理财深度分析
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

- **赛题**：银行 AI 智能体 —— 六场景全覆盖（转账/账单/理财/卡片/订阅/跨场景联动），理财操作为深度业务路径
- **评分维度**：任务完成率（40%）、安全性（30%）、创新性（30%）
- **核心交付**：六场景统一入口 + 理财可信闭环：意图 → 场景 DAG → 确定性闸门 → 三级权限 → 强验证 → 审计 → 记忆演化
- **选题逻辑**：每个场景都过同一套安全体系（闭集路由 + 域闸门 + 绿黄红分级 + 审计 + 熔断），广度不以牺牲安全承诺为代价；详见 [docs/六场景全覆盖设计方案_2026-10-11.md](docs/六场景全覆盖设计方案_2026-10-11.md)
