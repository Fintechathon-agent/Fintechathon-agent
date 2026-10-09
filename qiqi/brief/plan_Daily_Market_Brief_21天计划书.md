# Daily Market Brief · 21 天运营计划书

> 角色：每日市场信息简报负责人
> 周期：2026-10-08 ～ 2026-10-28（21 天，每天不断更）
> 发布：每天 18:00 项目群（5-10 分钟读完）+ 飞书文档「Daily Market Brief」专属章节归档
> 目标沉淀：News / Market Data → Event → Explanation → Risk → Decision 数据集
> 更新日期：2026-10-07（第 0 版，按"先定版、再优化"推进）

---

## 0. 一句话

用一条**可自动化的流水线**（采集 → 起草 → 自检 → 发布 → 归档），每天给团队一份 5-10 分钟读完的市场简报；21 天顺手把简报沉淀成 Agent 可用的**结构化数据集**，直接对应我们项目的 Data / Research / Risk / Memory 四层。

**现在就缺的 3 样**（其余都已就位）：
1. ~~飞书文档链接~~ ✅ 已确定：知识库「Personal AI Fund Manager｜TeamOS」（链接见 §9，首个 `### 2026-10-07` 小节已于 10/7 写入）；
2. 发布时间的确认（建议 18:00，A 股/港股收盘后、美股盘前）；
3. 每天 1 位轮值审核人（可选，只做 10 分钟数字复核）。

---

## 1. 为什么做（三个目标，各有验收）

| 目标 | 对谁有价值 | 21 天后怎么算做到了 |
|---|---|---|
| **① 行业敏感度** | 全团队：每天 10 分钟跟上市场，讨论有共同事实基础 | 群里每天有讨论（≥5 条回复的"今日问题"≥10 次） |
| **② 数据集沉淀** | 产品：金融决策 Agent 的原始语料 | `dataset/briefs_21d.jsonl` ≥ 60 条事件、≥21 条决策记录（含结果标注） |
| **③ 比赛素材** | 答辩：展示"Agent 的日常研究能力" | 用 21 天数据跑通 1 个 demo：Agent 引用某日记忆回答问题 |

**为什么是"事件→决策→结果"而不是新闻收藏**：新闻本身没有训练价值，有价值的是「事件 → 我们的判断 → 后来发生了什么」的标注三元组。21 天后这份数据可以直接导入 `agent/core/memory.py` 的 Hindsight 记忆库（World Facts / Experiences 两层），成为 demo 里 Agent"记得市场发生过什么"的证据链。

---

## 2. 交付规格（两个版本，一套内容）

### 2.1 群聊版（5 段式，400–800 字，速读 2–4 分钟，直接发群）

```
【Daily Market Brief｜MM/DD】

1. Market
沪深300：+0.8%｜NASDAQ：-1.2%｜黄金：+1.5%（核心资产 4-6 个，一行一个）

2. Key Event（3 条以内）
① XX公司发布Q3财报：Revenue +12% YoY，EPS低于预期5%
② …

3. Why it matters（逐条对应，基于数据，不靠感觉）

4. Agent Mapping（这条信息进 Data / Research / Risk / Memory 哪一层）

5. Question（一个二选一/三选一问题，让大家回复选项+理由）
```

### 2.2 飞书版（7 模块，5–10 分钟读完，专属章节，每天一个新 `### 日期` 小节）

> 分工：**群聊版**是精简导读（速读 2–4 分钟，含今日问题），**飞书版**是完整版（7 模块 + 表格 + 数据留档，5–10 分钟）。群里末尾附一句"完整版见飞书"。这样既满足"5–10 分钟可读完"，又不让群消息刷屏。

| 模块 | 每日内容 | 与群聊版的关系 |
|---|---|---|
| ① 市场行情 | 沪深300 / 标普500 / 纳指 / 黄金 / 原油 / 美债 | 群聊版第 1 段 |
| ② 异常波动 | 当日涨跌幅、成交量、波动率明显异常的资产 | 并入群聊版 Key Event |
| ③ 重要财报 | 1-3 家公司：营收、利润、指引、超预期/低于预期 | 并入群聊版 Key Event |
| ④ 重大新闻 | 真正影响资产价格的宏观/政策/行业/公司新闻 | 并入群聊版 Key Event |
| ⑤ 一句解释 | 为什么涨/为什么跌，尽量基于数据 | 群聊版第 3 段 |
| ⑥ Agent 映射 | 这条数据未来进入 Data / Research / Risk / Memory 哪一层 | 群聊版第 4 段 |
| ⑦ 今日问题 | 一个问题让团队讨论 | 群聊版第 5 段 |

### 2.3 质量红线（4 条，违反其一即当天作废重发）

1. **数字可回溯**：每个数字都能在当日 `out/market_YYYY-MM-DD.json` 里找到；用脚本采集，不手抄。
2. **事实与推断分开**：推断必须带"（推断）"标注；不确定就写"待确认"。
3. **不写投资建议**：只写"发生了什么+为什么"，给问题不给答案（合规要求，也是产品定位）。
4. **宁缺毋滥**：重大事件不足 3 条就写 1 条，但不硬凑凑数条目。

### 2.4 周报（Weekly Market Brief）格式（2026-10-07 登记）

> 按群内现行格式定版（国庆周版为蓝本），模板见 [`weekly_template.md`](./weekly_template.md)。骨架与日版一致、改周度口径：① 行情用「周累计」；② 异常波动必须写驱动；③ 财报＝本周海外财报/业绩指引汇总；④ Agent 映射多一行「录入范式」。
> 发布前同样过「核验五问 + 自检四问」；**数字必须与当周每日存档一致**，核不到一手源的标「待确认」。周报在飞书文档内以独立章节归档（见 §9）。

### 2.5 网页版（编辑式版式，单文件 HTML，2026-10-08 新增）

> 与飞书版同一份 Markdown（`out/brief_日期.md`），由 `make_brief_page.py` 渲染成 `out/brief_日期.html`：内联样式、零依赖，双击即开、可直接转发或打印；适配手机与深色模式。

版式参考 memene.cn/daily 的编辑式视觉语言（奶油色 Hero + 衬线大标题 + 蓝色 kicker + 编号目录侧栏），金融化改写：

| 要素 | 处理 |
|---|---|
| 涨跌色 | A 股习惯 **红涨绿跌**（低饱和：涨 `#B4453A`／跌 `#2D6A4F`） |
| 行情/映射 | 原生表格，数字 `tabular-nums`；映射表第二列不折行 |
| 异常波动 | 大号涨跌幅 + 一行说明的纵向卡片流 |
| 新闻/解释 | 衬线正文、编号列；口径说明用浅底注记块 |
| 今日问题 | A/B/C 选项卡片 + 「为什么」提示块 |
| 自动项 | 「约 N 分钟阅读 · M 项行情」按正文长度与行情行数推算；页脚自动带数据留档与核验记录 |

产出定位：群聊版负责"速读"，飞书版负责"归档检索"，**网页版负责"分享与展示"**（微信/邮件直接发一个文件即可，不需要登录飞书）。

**三件套与固定链接（2026-10-09 补）**：每次运行 `make_brief_page.py` 会同时产出——

| 文件 | 作用 |
|---|---|
| `out/brief_日期.html` | 当期页面（按日期存档，历史可回溯） |
| `out/index.html` | **入口页**：全部期数倒序列表，最新一期置顶并带「最新」徽标，每行显示摘要与阅读时长 |
| `out/latest.html` | **固定链接**：每次自动同步为最新一期内容，可长期收藏同一路径 |

含义：`brief_2026-10-07.html` 这类文件名只代表那一天，**永远不会有后续更新**；要跟踪最新一期请打开 `index.html` 或 `latest.html`。日报页 Hero 底部有「全部期数 →」入口，入口页顶部有固定链接指引。

**转发副本（2026-10-09 补，`out/share/`）**：每次运行同时产出一份**自包含**副本，文件名即标题，页面内不含任何跨文件链接——

| 文件 | 通道 | 对方怎么打开 |
|---|---|---|
| `每日市场简报_日期.html` | 电脑/邮件 | 双击用浏览器打开，无需联网、无需安装；作为附件发送即可 |
| `每日市场简报_日期.pdf` | 手机/微信/打印 | 各类 IM 与邮箱可直接预览；打印样式已锁定浅色，深色模式不会导出色底 |

归档页（`brief_日期.html` / `latest.html` / `index.html`）带互相跳转的链接，适合自己在一个文件夹里浏览；**要发人就发 `share/` 里那一份**。要「可点击的网址」则走飞书文档链接，或把仓库推到 GitHub 后开启 Pages。

---

## 3. 每日 SOP（时间轴，全程 30 分钟）

| 时间 | 动作 | 工具/产物 |
|---|---|---|
| 17:30 | 采集数据 | `python brief/collect_market_data.py` → `out/market_YYYY-MM-DD.json`（含财政部官方源、业绩预告官方分类） |
| 17:35 | 生成草稿 | `python brief/make_brief_draft.py` → 群聊版 txt + 飞书版 md（留 7 处 `【待填】`） |
| 17:40 | 补齐三个模块 | 补 why it matters / Agent 映射 / 今日问题（对照 `sample/brief_2026-10-07.md` 的深度） |
| 17:45 | 生成网页版 | `python brief/make_brief_page.py` → `out/brief_日期.html` + 自动重建 `out/index.html`／`out/latest.html`（编辑式版式，见 §2.5） |
| 17:50 | **核验 + 自检** | 核验五问 + 自检四问（见下） |
| 18:00 | 发布：群发 + 飞书归档 | `python brief/upload_feishu.py --doc … --webhook-file …` |
| 次日 17:40 | 复盘昨日问题 | 把群里答案写进 `decision.team_answer`，T+1/T+5 回填 `outcome_check` |

**核验五问**（每条入选 Key Event 的信息都过一遍，2026-10-07 核验实战后加入）：
1. **数字能回溯到一手源吗？**（美债→财政部官网；公司财务→公告原文；行情→双源交叉）
2. **转述链条有多长？**（东财快讯 ← 谁 ← 官方？链越长越要标"转述"）
3. **历史比较成立吗？**（"XX 年以来最高"→ 用全历史数据逐日验证精确日期）
4. **口径对吗？**（预测类型分类 vs 关键词匹配；合同利率 vs 有效利率；收盘 vs 盘中）
5. **查不到一手源怎么办？**→ 标注"待确认"、写进简报、留一个核验钩子到次日

**自检四问**（每天 30 秒）：
1. 数字和 JSON 对得上吗？（休市日的"最新价"其实是几天前的，必须标注日期）
2. 时间戳对吗？（隔夜美股 / 盘中商品 / 当日收盘，三种口径不能混）
3. 口径对吗？（指数用收盘价；商品用盘中最新；美债注明数据日期与来源层级）
4. 有没有把推断写成了事实？有没有把"转述"写成了"确认"？

---

## 4. 数据源与降级链（2026-10-07 全部实测 + 交叉核验）

| 源 | 用途 | 实测状态 | 降级方案 |
|---|---|---|---|
| **美国财政部官网** `home.treasury.gov`（daily_treasury_yield_curve CSV） | 美债 10Y / 30Y **一手来源** | ✅ 可用（北京时间次日凌晨可得，比 FRED 早约 1 个交易日） | FRED（滞后 1-2 日） |
| 新浪 `hq.sinajs.cn` | A股/港股/美股指数、商品、汇率 | ✅ 可用（需 `Referer: https://finance.sina.com.cn`）；**已与东财逐项交叉一致** | 东财 `push2.eastmoney.com`（实测可用，双源互验） |
| 东财快讯 `newsapi.eastmoney.com` | 实时新闻流 | ✅ 可用（每次 100 条，带时间戳与 digest 摘要） | 新浪滚动新闻 `feed.mix.sina.com.cn`（实测可用） |
| **东财数据中心** `RPT_PUBLIC_OP_NEWPREDICT` | A 股业绩预告（**官方分类字段** PREDICT_TYPE） | ✅ 直连可用（比 akshare 文本匹配口径准确；akshare 曾超时） | akshare `stock_yjyg_em`（口径粗，会算宽） |
| 腾讯 `qt.gtimg.cn` | 备用行情 | ✅ 可用 | — |

**两条核验纪律**（2026-10-07 核验后加入）：
1. **快讯里的转述数字必须回溯**：如"美国30年期国债收益率升破5.7%"→ 用财政部官方 CSV 核实实际收盘值与上个交易日；"2002 年以来最高"这类历史比较 → 用 FRED 全历史逐日验证（本次实测：上次 30Y ≥5.70% 是 2002-06-11，故准确表述为"2002 年 6 月以来最高"）。
2. **公司/机构数据用官方分类字段，不用关键词匹配**：业绩预告的"预喜"必须按 PREDICT_TYPE 分类统计（预增+略增+续盈+扭亏），避免把"减亏"等宽口径混入；MBA 房贷利率之类机构调查数据 → 尽量回溯机构官方新闻稿（区分合同利率 vs 有效利率）。

**一手来源核验清单**（2026-10-07 实测）：

| 事项 | 一手来源 | 核验结果 |
|---|---|---|
| A 股休市安排 | 上交所官网 `sse.com.cn/disclosure/dealinstruc/closed/` | ✅ 已核验原文：「国庆节：10月1日至10月7日休市，10月8日起照常开市」 |
| 美债收益率 | 美国财政部 `home.treasury.gov` 每日收益率曲线 CSV | ✅ 可抓取（已接入采集脚本 `rates.official`） |
| 行情价格 | 新浪 ↔ 东财 `push2` 双源 | ✅ 指数级完全一致（沪深300/恒指/美股三大） |
| A 股业绩预告 | 东财 `RPT_PUBLIC_OP_NEWPREDICT`（PREDICT_TYPE 官方分类） | ✅ 可直连，口径比 akshare 文本匹配准确 |
| 公司公告 | 上交所 `sse.com.cn` / 巨潮 `cninfo.com.cn` | ✅ 华海药业公告已核验（临2026-106：归母净利 10.28–11.03 亿、+170%~190%；扣非 6.62–7.43 亿、+145%~175%） |
| 美国机构调查（MBA 等） | mba.org 官方新闻稿 | ⚠️ 直连 403；MBA 7.49% 未取到官方稿，标注"转述" |

**"存疑即标注"实例**（2026-10-07 实战）：东财快讯称"伊朗将封锁霍尔木兹海峡非法通道/总统称全面战争"，但路透、美联社、必应中英文检索均未见同日一手报道，且同类表述在 2026 年 7-8 月已出现过——已在简报中明确标注"待确认"，并在 Agent 映射里给出设计启示：**"快讯转述"与"官方确认"应作为两个可信度等级进入 Hindsight 记忆**。

已排除：天天基金 `fundgz`（2026 年已下线）；stooq（本环境不可达）。
采集脚本已就位：`brief/collect_market_data.py`，一条命令产出当日 JSON + 控制台摘要（含双源、官方源）。

---

## 5. 数据集 Schema（本计划的核心资产）

每条记录 = 一个事件，落一条 JSONL（`dataset/briefs_21d.jsonl`）：

```json
{
  "id": "2026-10-07-E1",
  "date": "2026-10-07",
  "stage": { "source": "news", "raw_ref": "out/market_2026-10-07.json#news[12]" },
  "event": {
    "type": "rates|earnings|policy|geopolitics|commodity|fx",
    "headline": "美 30 年期国债收益率升破 5.7%",
    "facts": { "us30y": 5.7, "us10y": 5.31 },
    "as_of": "2026-10-07T17:38:00+08:00",
    "source": { "name": "东方财富快讯", "url": "…" }
  },
  "explanation": {
    "mechanism": "长端利率上行 → 折现率上行 → 压制高估值与不生息资产",
    "why_matters": "跨资产传导最典型的一条链",
    "confidence": "high"
  },
  "risk": {
    "direction": "down", "affected_assets": ["黄金", "高估值成长股"],
    "horizon": "short", "severity": 2
  },
  "agent_mapping": {
    "layer": "Risk", "module": "RiskEngine",
    "usage": "利率敏感度检查：用户持仓含黄金/成长股时触发复核"
  },
  "decision": {
    "question": "30Y 升破 5.7% + 持仓黄金 ETF 20%，Agent 应：A Hold / B Reduce / C Review？",
    "options": ["Hold", "Reduce", "Review"],
    "team_answer": "", "outcome_check": { "at": "T+1", "result": "" }
  }
}
```

**字段 → Hindsight 四层记忆**（`agent/core/memory.py`）：

| 字段 | 记忆层 | 说明 |
|---|---|---|
| `event.facts` | **World Facts** | 客观数据，支持定期验证 |
| `explanation` | **Observations** | 市场判断/风险识别，置信度可演化 |
| `decision.team_answer + outcome_check` | **Experiences** | 含实际结果，用于反馈学习 |
| 21 天后归纳的"高频事件→风险映射" | **Mental Models** | 自我生成规则，带版本与成败计数 |

---

## 6. 21 天排期（10/8 – 10/28，与比赛节点对齐）

| 阶段 | 日期 | 重点 | 验收 |
|---|---|---|---|
| **P1 校准期** | D1–D3（10/8–10/10） | 格式定版；脚本流水线跑通；收集团队对格式的意见并改一次 | 3 天不断更；格式冻结 |
| **P2 稳定期** | D4–D14（10/11–10/21） | 每天 3-5 事件；每周日发「周报」（格式见 §2.4：一周涨跌 + 驱动 + 上周问题复盘） | 数据集字段无缺失；≥10 次群讨论 |
| **P3 收官期** | D15–D21（10/22–10/28） | 导出 `briefs_21d.jsonl`；产出《高频事件—风险映射表》1 页；接入 Hindsight 做召回 demo | Agent 能引用某日 Brief 回答问题 |

**日历提醒**：
- 10/8 是国庆假期后 A 股首个交易日（10/1–10/7 休市），首日简报重点是"节后首日+隔夜美股+假期事件汇总"；
- 10 月中旬起美股 Q3 财报季开启（银行股打头、科技股密集），③ 重要财报 模块进入高产期；
- 10/29–11/01 不做新简报，转为答辩材料集成缓冲（作品提交截止 11/02）。

---

## 7. 与 Agent 模块的映射（落到代码）

| 简报内容 | 项目资产 | 落点 |
|---|---|---|
| 行情数据 | `MarketData`（contracts/types.py） | `agent/tools/market.py` `MarketDataTool`（新增：简报同款数据源落地） |
| 新闻/快讯 | `NewsItem` | `agent/tools/news.py` `NewsTool`（新增：东财快讯真实源） |
| 异常波动规则 | — | `MarketDataTool` 增加"单日\|涨跌\|超阈值打标" |
| 风险条目 | `RiskReport` | `agent/risk/engine.py` `RiskEngine`（新增：利率敏感度因子） |
| 每日问答 | `Recommendation` 思路 | `agent/orchestrator` DecisionMaker 的问题范式素材 |
| 数据集 | `MemoryFact / Observation / Experience` | `agent/core/memory.py` + `agent/tools/memory_tools.py`（`memory_retain` 批量导入） |

---

## 8. 风险与预案

| 风险 | 预案 |
|---|---|
| 数据源单点失效 | 每次采集都留 JSON 存档 → 源挂了可人工补齐；降级链见 §4 |
| 无重大新闻的日子 | 设「静默日」：如实写"今日无重大事件"，补 1 条周度观察，不硬凑 |
| 数字口径错误 | 自检四问 + 关键数字双源交叉（新浪 vs 东财） |
| 节假日/休市 | 日历前置，休市日只更新隔夜美股/商品 + 周度回顾 |
| 断更 | 采集自动化（已就位）；草稿可开每日自动生成，人只做 10 分钟审校 |

---

## 9. 飞书落地（怎么连起来）

> **落地现状（2026-10-07 更新）**：目标文档已确定 —— 知识库「Personal AI Fund Manager｜TeamOS」
> `https://rcntz7sdyswd.feishu.cn/wiki/LB0Xw98WniMV6okz9HqcGMDCnW7`
> 文档内已建 `## Daily Market Brief（每日市场简报）` 章节，首个 `### 2026-10-07` 小节已写入。
> 当前同步走**浏览器粘贴通道**（`make_feishu_section.py` 生成章节 → `push_brief_section.ps1` 进剪贴板 → 文档末尾 Ctrl+V，
> 飞书自动把 Markdown 转成原生标题/表格/列表）；配置应用凭证后可升级为 API 追加（`upload_feishu.py`，wiki 节点需知识库权限 + 应用加入知识库成员）。
> 周报（Weekly）同文档内独立章节 `## Weekly Market Brief` 归档（首期核验通过后建立），不与日报混排。

**飞书文档归档**（一次配置、之后每天一条命令）：
1. 建一个飞书文档「Daily Market Brief」，新建一节「Daily Market Brief」专用章节（每天往里追加 `### 日期` 小节）；
2. 在飞书开放平台建一个**企业自建应用**，开通文档读写权限并发布；把上面这篇文档**共享给该应用（可编辑）**；
3. 把 App ID / Secret 和文档链接写进 `brief/feishu.local.json`（格式见 `brief/README.md`）；
4. 之后每天：`python brief/upload_feishu.py --doc "<文档链接>" --file out/brief_日期.md --webhook-file out/group_日期.txt`。

**群消息发布**：两种方式任选——
- 自定义群机器人 webhook（最简单，支持签名校验）：群里 → 设置 → 群机器人 → 添加自定义机器人 → 拿 webhook 地址；
- 或直接人工复制群聊版（推荐前 3 天人工发，确认格式后再自动化）。

**上传脚本已就位**：`brief/upload_feishu.py`（Markdown → 飞书文档 block 追加 + 群消息，两种模式可同时用；未配置凭证时会明确提示跳过，不会误报成功）。

---

## 10. 可借鉴的开源项目（GitHub 调研，2026-10-07）

> 星数于 2026-10-07 从 GitHub API 实取（未逐一精确者注"约"）。

**最值得深入的 3 个：**

1. **TauricResearch/TradingAgents**（约 11 万 star）— 分析师团队（基本面/情绪/新闻/技术）→ 多空辩论 → 风控 → 组合经理，四层链路与我们的 Agent 架构同构；每个分析师产出独立报告 + 结构化输出 + **决策日志与到期结算反思**（这正是我们要的"21 天后回填结果"机制）。中文版 **hsliuping/TradingAgents-CN**（约 3.2 万）已接 Tushare/AKShare/DeepSeek，可对照其数据源层。
2. **Thysrael/Horizon**（约 9.6k）— 中英双语 AI 新闻雷达，每日生成 Markdown 简报并多渠道分发（邮件/企微/Webhook）。可借鉴：**按 category 配额限流**（不让某一类新闻刷屏）、多源清单（RSS/Google News/GDELT/OpenBB）、"事件+背景+影响"三段式模板。
3. **AI4Finance-Foundation/FinRobot**（约 8.1k）— Lead→Data→Analysis→Synthesis→Report 管线；可借鉴其 **13 章研究报告骨架**与 **7 数据源 failover** 设计（对应我们的降级链）。

**字段契约（最直接可抄）：**

- **virattt/ai-hedge-fund**（约 6.4 万）：LLM agent 输出契约 `{signal: bullish/neutral/bearish, confidence: 0-100, reasoning}` —— 我们 §5 schema 的 `risk.direction / confidence` 直接沿用这套三值语义。
- **Zdong104/FNSPID_Financial_News_Dataset**（约 470）：新闻字段 date/article_title/stock_symbol/url/publisher + 按日期对齐 OHLCV —— 数据集的"新闻↔代码↔日期"对齐法。
- **THU-KEG/MAVEN-dataset**（约 167）：事件类型 + trigger word 标注体系（168 类）—— 我们 `event.type` 取它的顶层大类。
- **shun-zheng/Doc2EDAG**（约 348）：中文公告事件抽取（DCFEE：股权冻结/质押/回购/增持/减持）—— A 股公告类事件的中文 schema 参考。
- **pipiku915/FinMem-LLM-StockTrading**（约 960）：分层记忆 + **每日复盘反思**，与我们 Hindsight 四层 + 21 天沉淀机制可对照实现。

**结论**：开源界没有现成的「News→Event→Explanation→Risk→Decision」schema，需要组合：News 层抄 FNSPID 字段 → Event 层抄 MAVEN 类型体系（A 股用 DCFEE 五类）→ Explanation/Risk/Decision 抄 TradingAgents 的"报告-辩论-风控"结构与 ai-hedge-fund 的 signal/confidence 契约。本计划 §5 的 schema 已完成这一组合。

---

## 11. 明天（10/8）第一版怎么做

1. 17:30 跑采集：`python brief/collect_market_data.py`（首日数据量大：假期 8 天事件 + 隔夜美股）
2. 按 `brief/sample/brief_2026-10-07.md` 的格式起草（首日重点：节后首日情绪、假期消费/出行数据、美债利率、黄金回调、三季报预告）
3. 自检四问 → 群里发（人工发，收集格式反馈）
4. 建档 `dataset/briefs_21d.jsonl`，把当日 3-5 条事件按 §5 schema 入库
5. 记录发布耗时与卡点，P1 结束（10/10）时做一次格式定版复盘

---

## 12. 21 天验收标准

- [ ] 21 份简报不断更（群 + 飞书各 21 次）
- [ ] `dataset/briefs_21d.jsonl`：≥60 条事件、≥21 条决策记录（含 T+1/T+5 结果标注）
- [ ] 《高频事件—风险映射表》1 页（21 天里重复出现的事件类型 → 影响资产 → 建议 Agent 动作）
- [ ] 1 个可演示闭环：Agent 从 Hindsight 召回某日 Brief 的事实并回答一个组合问题
