# Daily Market Brief · 工作目录说明

> 21 天每日市场简报的采集、起草、发布工具集。计划书见 [plan_Daily_Market_Brief_21天计划书.md](./plan_Daily_Market_Brief_21天计划书.md)。

## 目录结构

```
brief/
├─ collect_market_data.py          # 采集：行情/利率/快讯/业绩预告/产品投资池 → out/market_日期.json
├─ collect_fund_data.py            # 采集：旗舰基金池净值 + 全市场快照 → out/fund_日期.json、fund_all_日期.json
├─ make_brief_draft.py             # 起草：JSON → 群聊版 txt + 飞书版 md（【待填】占位待人补）
├─ upload_feishu.py                # 发布：文档追加 + 群消息（需凭证，见下）
├─ make_brief_page.py              # 网页版：brief_日期.md → out/brief_日期.html（编辑式版式）
│                                  #   同时重建 out/index.html（全部期数入口页）+ out/latest.html（固定链接）
├─ make_feishu_section.py          # 章节提取：brief_日期.md → out/feishu_section_日期.md
├─ push_brief_section.ps1          # 剪贴板推送：把章节文件放进剪贴板（飞书文档粘贴同步用）
├─ db.py                           # 私有数据库（SQLite）schema + 幂等写入 + 产品侧读取
├─ ingest_to_db.py                 # 回填：采集 JSON/数据集/成稿 → db/market.db（幂等）
├─ plan_Daily_Market_Brief_21天计划书.md
├─ sample/brief_2026-10-07.md      # 样板间：人工打磨过的完整示例
├─ dataset/                        # 21 天数据集（briefs_21d.jsonl）
├─ db/                             # 私有数据库 market.db（本机，.gitignore 排除）
└─ out/                            # 每日产出：market_*.json、brief_*.md、group_*.txt
```

## 每日 4 条命令

```bash
# 1. 采集（约 20 秒，含 akshare 业绩预告）
python brief/collect_market_data.py

# 2. 生成草稿（自动拼行情表/异常波动/重点快讯/业绩预告，留 7 处【待填】）
python brief/make_brief_draft.py

# 3. 人工补齐（10 分钟）：搜索 out/ 里的 【待填】，补 why it matters / Agent 映射 / 今日问题
#    参考 sample/brief_2026-10-07.md 的写法与深度

# 4. 生成网页版（编辑式版式，单文件 HTML，可直接打开/转发/打印）
python brief/make_brief_page.py
#    → out/brief_2026-10-08.html   本期
#    → out/index.html              入口页（全部期数，最新置顶）
#    → out/latest.html             固定链接（永远指向最新一期）
#    → out/share/                  转发副本（HTML + PDF，见「把日报发给别人看」）

# 5. 发布：飞书文档同步 + 群消息
# 5a. 生成章节文件（从「### 日期」起，供追加写入文档）
python brief/make_feishu_section.py

# 5b. 同步到飞书文档（当前通道：浏览器粘贴，无需 API 凭证）
powershell -NoProfile -ExecutionPolicy Bypass -File brief/push_brief_section.ps1 \
  -Path out/feishu_section_2026-10-08.md
#     然后在飞书文档末尾点最后一个空段落 → Ctrl+V（Markdown 自动转原生格式）→ 确认「已保存到云端」

# 5c. 群消息（需 webhook）
python brief/upload_feishu.py --webhook-file out/group_2026-10-08.txt

# 5d. （可选）配置应用凭证后，文档可改走 API，最稳
python brief/upload_feishu.py --file out/brief_2026-10-08.md --from-heading "### 2026-10-08"
```

首日想先人工发群：跑完第 1-3 步，把 `out/group_*.txt` 内容复制到群里即可。

## 网页版日报（编辑式版式）

`make_brief_page.py` 把 `out/brief_日期.md` 渲染成单文件 HTML（`out/brief_日期.html`）：内联样式、零依赖，
双击即可打开 / 转发 / 打印，也适配手机与深色模式。

版式参考 memene.cn/daily 的编辑式视觉语言，金融化改写：

| 要素 | 做法 |
|---|---|
| Hero | 奶油色卡片 + 思源宋体大标题 + 蓝色 kicker 标签（`DAILY BRIEFING · 日期`） |
| 导航 | 桌面左侧粘性编号目录（滚动高亮）；<1024px 自动隐藏 |
| 行情/映射 | 原生表格；涨跌按 A 股习惯**红涨绿跌**，数字 `tabular-nums` 对齐 |
| 异常波动 | 大号涨跌幅 + 说明，纵向卡片流 |
| 财报/新闻 | 衬线正文 + 编号列；引用类信息用浅底注记块 |
| 今日问题 | A/B/C 选项卡片 + 「为什么」提示块 |
| 配色 | 暖白底 `#FBFAF8`、墨黑 `#141413`、kicker 蓝 `#2563EB`、强调深蓝 `#1E3A5F` |
| 字体 | 标题：Source Han Serif SC / Noto Serif SC；正文：PingFang SC / MiSans / 雅黑 |

> 「约 N 分钟阅读 · M 项行情」由正文长度与行情行数自动计算；页脚自动带上文末的数据留档与核验记录。

## 把日报发给别人看（三种通道）

`make_brief_page.py` 每次运行都会在 `out/share/` 生成两份**转发副本**（文件名即标题）：

| 文件 | 用途 | 对方怎么打开 |
|---|---|---|
| `每日市场简报_日期.html` | 电脑端分享 | 双击即用浏览器打开，**不需要联网**、不需要装任何东西；可直接转发邮件/微信「文件」 |
| `每日市场简报_日期.pdf` | 手机端/打印 | 微信、邮箱、各类 IM 里都能直接预览；适合发朋友圈以外的正式场合 |

转发副本与归档页的区别：副本**页面内不含任何跨文件链接**（已设计成自包含），所以单独把这一个文件发给任何人都不会出现打不开的链接或丢样式。归档用的 `brief_日期.html`、`latest.html`、`index.html` 则带有互相跳转的链接，适合放在同一个文件夹里自己浏览。

**要一个可点击的网址**（对方不用下载文件）：两条现成通道——① 飞书文档链接（团队已在用的归档通道，见下文）；② 若把仓库推到 GitHub 并开启 Pages，`out/` 可作为站点发布（需先配置 GitHub 凭证，见根目录 `github-push.cmd`）。

## 自动化状态

- **已配置定时任务**：「每天17:35市场日报自动生成」，2026-10-08 起每天 17:35 自动执行采集（行情+基金）→草稿→补齐→网页/飞书章节→**私有库入库**→飞书文档同步。
- **文档同步目标（已接通）**：`https://rcntz7sdyswd.feishu.cn/wiki/LB0Xw98WniMV6okz9HqcGMDCnW7`（知识库「Personal AI Fund Manager｜TeamOS」）。当前走浏览器粘贴通道，无需凭证；配置应用凭证后自动切换为 API 通道。
- 群消息需先配好 webhook，否则该通道跳过并在汇报中说明。
- 手动补跑：`python brief/collect_market_data.py && python brief/make_brief_draft.py`，或双击 `一键发布.cmd`。
  - 该脚本为纯 ASCII 实现（中文消息全部由 Python 侧打印）：cmd.exe 解析含中文的批处理不可靠，且 `%date%` 在中文系统下不是 ISO 格式，故日期改由 Python 提供。
  - 已成稿保护：重复运行不会把已补齐的 `brief_日期.md` 覆盖回【待填】模板。

## 飞书文档同步（已接通）

**结构约定**：文档中一个 `## Daily Market Brief（每日市场简报）` 章节，每天在其下追加一个 `### 日期` 小节（首个 2026-10-07 已于 10/7 写入）。周报（每周日）格式单独登记：见计划书 §2.4 与 `brief/weekly_template.md`；核验通过后在同文档以 `## Weekly Market Brief` 章节归档。

**通道 A：浏览器粘贴（当前默认，无需任何凭证）**
1. `python brief/make_feishu_section.py` 生成 `out/feishu_section_日期.md`；
2. `powershell -NoProfile -ExecutionPolicy Bypass -File brief/push_brief_section.ps1 -Path out/feishu_section_日期.md` 写入剪贴板（脚本自带 SHA256 一致性校验）；
3. 在已登录的飞书文档里进入编辑模式 → 滚到最底部 → 点最后一个空段落 → Ctrl+V；
4. 飞书会把 Markdown 自动转成原生标题 / 表格 / 列表 / 分隔线，确认顶部「已保存到云端」。

**通道 B：API 追加（可选升级，更稳）**
配置 `feishu.local.json` 的 `app_id` / `app_secret` 后（步骤见下节），执行：
`python brief/upload_feishu.py --file out/brief_日期.md --from-heading "### 日期"`。
> 注意：目标是**知识库（wiki）节点**，应用除 `docx:document` 外还需知识库相关权限，并把应用加入该知识库成员（可编辑）。

## 飞书配置（一次）

**A. 群机器人（发群用，5 分钟）**
1. 飞书群 → 设置 → 群机器人 → 添加机器人 → **自定义机器人**；
2. 安全设置：推荐勾「签名校验」拿到密钥（也可选关键词「Daily Market Brief」）；
3. 把 webhook 地址写进 `brief/feishu.local.json`（见下）。

**B. 文档归档（写飞书文档用，15 分钟）**
1. 飞书开放平台 open.feishu.cn → 开发者后台 → **创建企业自建应用**；
2. 权限管理：开通 `docx:document`（查看、编辑、创建新版文档，读写）；
3. 创建版本并发布（企业管理员通过后生效）；
4. 打开目标飞书文档 → 分享 → 添加协作者 → 搜索**应用名称** → 权限「可编辑」；
5. 回到应用「凭证与基础信息」复制 **App ID / App Secret**。

**C. 凭证文件**（或改用环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_WEBHOOK` / `FEISHU_WEBHOOK_SECRET`）

```json
{
  "app_id": "cli_xxxxxxxx",
  "app_secret": "xxxxxxxx",
  "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx",
  "webhook_secret": "签名密钥（没开签名校验就留空）"
}
```

> ⚠️ `feishu.local.json` 含密钥，不要提交到 git（已在 `.gitignore` 中排除）。

未配置凭证时脚本会打印 `[skip]` 提示并给出补齐方法，不会误报成功。

## 数据源（2026-10-07 实测 + 双源交叉核验）

| 源 | 用途 | 备注 |
|---|---|---|
| **美国财政部官网** `daily_treasury_yield_curve` | 美债 10Y/30Y（一手） | 北京时间次日凌晨可得，比 FRED 早约 1 个交易日；脚本字段 `rates.official` |
| 新浪 `hq.sinajs.cn` | A股/港股/美股/商品/汇率 | 必须带 `Referer: https://finance.sina.com.cn`；已与东财逐项交叉一致 |
| 东财 `push2.eastmoney.com` | 行情备用源（交叉核验用） | 与新浪数值一致（指数级吻合） |
| 东财快讯 | 新闻流（100 条/次） | 自动按关键词打标：earnings/macro/policy/company/commodity/geopolitics |
| **东财数据中心** `RPT_PUBLIC_OP_NEWPREDICT` | A 股业绩预告（官方分类） | 按 PREDICT_TYPE 统计：预喜=预增+略增+续盈+扭亏（不含"减亏"） |
| FRED `fredgraph.csv` | 美债全历史（核验用） | 用来验证"XX 年以来最高"这类历史比较；官网值有 1-2 日滞后 |
| **东财 F10 净值 API** `api.fund.eastmoney.com/f10/lsjz` | 旗舰基金池净值历史（10 只，股票/混合/指数/债券/货币） | 需 Referer `fundf10.eastmoney.com`；货币型基金该接口净值实为「万份收益」，使用前留意 |
| akshare `fund_open_fund_daily_em` | 全市场基金每日净值快照（约 2.4 万只） | 失败自动跳过，不影响主线 |

## 私有数据库（本机数据底座，勿外发）

`brief/db/market.db`（SQLite）是日报与「理财旗舰」的**本地数据底座**，按用户要求
**只留本机、不进 GitHub、不发给任何人**（已 .gitignore；`out/market_*.json` 等
原始采集 JSON 同样已移出 git 跟踪）。对外只分享「五件套」成品文档。

| 表 | 内容 | 主键 |
|---|---|---|
| quotes | 每日行情快照（指数/产品投资池个股+ETF/港股/美股/商品/汇率） | (date, market, code) |
| rates | 美债 10Y/30Y（财政部官方 + FRED 双源并存） | (date, series, source) |
| news | 快讯 | (date, title) |
| earnings | 业绩预告汇总 | (date, report_date) |
| fund_nav | 旗舰基金池净值历史 | (code, date) |
| fund_all | 全市场基金每日净值快照 | (code, date) |
| brief_events | 事件→解释→风险→决策 标注数据集（briefs_21d.jsonl） | id |
| briefs | 成稿留档（群聊版 + 飞书版正文） | date |

命令：

```bash
python brief/collect_fund_data.py            # 采集旗舰基金池 + 全市场快照（定时任务已含）
python brief/ingest_to_db.py --all           # 全量回填（幂等，可反复跑）
python brief/ingest_to_db.py --date 2026-10-12   # 只回填某一天
```

产品侧读取示例：`brief/db.py` 提供 `latest_quotes()`（最新行情快照，可补全持仓价格）
与 `series_history()`（利率序列）。定时任务每天 17:35 采集后自动入库，行情类数据
当日更新、基金净值 17:35 时可能尚未出当日净值（基金公司晚间发布，次日入库补齐）。

**核验纪律**（每次简报发布前）：
1. 快讯里的转述数字（"升破 X%""2002 年以来最高"）→ 用官方源/全历史数据回溯后再生效；
2. 公司财务数据用官方分类字段，不用关键词文本匹配；
3. 关键行情双源交叉（新浪 vs 东财），偏差 >0.5% 要查原因；
4. 所有数字必须标注实际数据日期（休市/滞后源尤其重要）。

## 已知边界

- 飞书文档 block 转换（仅 API 通道）：Markdown 表格会降级为「列 ｜ 列」文本行（飞书原生表格 block 结构复杂，稳定优先）；有序列表降级为项目符号。**浏览器粘贴通道无此限制**——飞书自动把 Markdown 转成原生表格/标题/列表/分隔线。
- 浏览器粘贴通道依赖飞书网页登录态；掉登录时重新登录即可，成品文件始终保留在 `out/`。
- `upload_feishu.py` 的文档模式需要应用权限与文档共享两步都正确；首次运行失败时按返回的 `code/msg` 对照上面 B 节排查。
- 节假日 A 股/港股休市：行情会返回上一交易日数据，脚本输出里带日期，起草时必须核对（自检四问第 1 条）。
- 东财快讯的 `digest` 字段是转载摘要，不是原始出处；公司公告类信息建议回溯巨潮/交易所原文。
