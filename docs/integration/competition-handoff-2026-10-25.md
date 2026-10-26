# Personal AI Fund Manager 参赛交接单（2026-10-25 更新）

> 最新续办入口为 `qiqi/web/guest_gateway.py --port 8877`：本机访客隔离、Finance 统一账本及 262 项回归已完成；每日 20 元测试预算已获用户批准。权限申请文本、当前限制和真实模型/设备验收步骤见 [续办记录](staging-access-and-guests-2026-10-25.md)。下文保留上一轮证据与统计，不能将旧的 0 元授权当作最新授权。

> 统一入口 P0 的本地断点已修复：顶部自然语言输入会自动委派理财请求并发起 `/api/review`，同一访客会话的三场景 HTTP 验收 12/12 通过。公开主聊天源码与团队 staging 仍缺失，故线上同任务闭环未通过。详见 [本地修复与接线边界](unified-entry-local-2026-10-25.md)。

交付分支 `codex/competition-integration-20261025`，[Draft PR #31](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/31)。当前是本地集成候选版，**未完成线上 staging 验收，未生产发布**。模块与唯一 Owner、版本来源、实际架构和阻塞见 [审计](audit-2026-10-25.md)。

## 可运行与可展示内容

独立演示可展示：知识解释不触发交易；按真实输入解析张伟/700 元/房租，确认后生成模拟回执；读取和上传账单后精确汇总；持仓计算。另有真实本机 Finance Python → Risk Node → Core Worker handler HTTP → HMAC 回调证据。其模型/存储使用测试替身，不能剪辑成主聊天的线上真实模型闭环。

银行现金与投资组合现金目前来自不同夹具，演示时必须说明。共享 demo_user 只可用于单人隔离演示，不能宣称多用户或跨设备同步。

## 本轮验证统计

| 类别 | 用例与通过数 | 失败 | 范围/复现 |
| --- | --- | --- | --- |
| 模块完整回归（混合确定性与 Mock，非 E2E） | Core 317/317、Finance 251/251、Risk 677/677，共 1,245 | 0 | 下方三组完整回归命令 |
| 确定性计算与上传专项（上表子集，不能累加） | 10/10 | 0 | test_preview_contract + test_bill_import；无模型 |
| 当前源码 Core/Risk HTTP（Mock 模型及存储） | 12/12 | 0 | joint-acceptance/run.cjs --current-source |
| 当前源码 Finance/Risk/Core 三服务 HTTP（Mock 模型及存储） | 6/6 | 0 | verify-current-http.cjs |
| 本轮真实模型调用 | 0 次、0 项通过 | 未执行 | 预算 0；不得算通过 |
| Windows Chrome 实际交互 | 3/3：知识、700 元模拟转账、账单 | 0 | 本机 127.0.0.1:8876；见浏览器记录 |
| 构建/静态检查 | Core check、Risk build、打包 Worker/D1 夹具、UI JS 语法通过 | 0 | 下方命令 |

测试中的 audit unavailable、fake timeout 等日志是故障注入。12 项 HTTP 用例覆盖正常确认、房租/学费冲突、用途更新、拒绝审批、费用未知、伪造签名/跨任务、只读能力、未知回调、未知存储结果、改参审批失效、跨任务资金重核。正常确认的批准身份为签名测试服务，不能冒充真实最终用户认证。

6 项三服务检查覆盖：capabilities 机器鉴权且不推理、伪造身份提前拒绝、保护用途 10,000 元后的投资阻断及同任务签名回调、重试无第二次模型调用、同键改参 409、直接 Core 请求保留幂等键。模型替身调用 2 次，真实调用 0 次。

版本化证据见 [evidence-20261025](evidence-20261025/README.md)，包含源码哈希、HTTP 状态、任务关联和明确的替身标识。

## 15 项内部验收映射

| # | 要求 → 实现与演示步骤 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 输入持仓 60,000/20,000/20,000 → 100,000、60/20/20% | test_preview_contract 精确夹具 | 本地已通过 |
| 2 | 明细/分类/总额一致；退款抵减、收入不计、重复保留标记 | test_bill_import；浏览器 17,559.70 元、28 笔、分类差 0 分 | 本地已通过 |
| 3 | 张伟 700 元、备注房租 → 待确认 → 模拟回执 | 浏览器余额 25,680.50 → 24,980.50；服务测试核对不唯一时澄清 | 本地已通过；统一主聊天未验 |
| 4 | “基金是什么” → 内置知识解释、无买卖/审批 | 浏览器与 Finance 回归 | 本地已通过；主聊天未验 |
| 5 | 两份 CSV/TXT → 不同金额、批次、trace；坏行/超限失败 | test_bill_import；此前 HTTP 上传净额 30.20，坏金额 400 | 本地已通过；公开 UI 未发布 |
| 6 | 12,000 元中保护学费 6,000+房租 1,500+生活费 2,500 → 可用 2,000；投资 8,000 BLOCK | 三服务 HTTP 报告：不足 6,000、无执行回执、同 task_id | 本地已通过，模型替身 |
| 7 | 未批直接执行、改参复用批准 → 拒绝 | 12 项 HTTP、Core/Risk 门禁；Finance live 伪验证拒绝 403 | 本地已通过；可信用户登录未验 |
| 8 | 风控/存储故障或未知现金 → 不执行 | HTTP 未知回调/存储、preview 未知现金、执行安全回归 | 本地已通过 |
| 9 | 同请求重放/并发 → 一次业务效果 | Core/Risk/Finance 幂等回归；三服务重放无第二次推理 | 本地已通过；线上并发未验 |
| 10 | 账单备注注入不升级为授权、不改变账本 | test_bill_import 与 Risk/Core 注入负例 | 本地已通过；主聊天全链未验 |
| 11 | 记忆更新、纠正、删除、用户/模式隔离 | 模块有部分测试；Finance 仍共享 demo_user | 尚未达到集成验收 |
| 12 | 鉴权、限流、超时、预算不足分开呈现 | 百炼供应商替身与预算测试；live 禁止假成功回退 | 本地 Mock 通过；真实模型未验 |
| 13 | 以分为单位，40.0203+预留10>50，上游前拦截 | chenchen/tests/bailian.test.mjs、并发预算测试 | 本地已通过 |
| 14 | 三场景由主聊天发起，同任务查看工具/风险/批准/回执 | 已有一条本机 Finance/Risk/Core 链；主聊天源码未取得 | 尚未验证或受阻 |
| 15 | 大陆无代理及 iOS/Android/Windows/macOS | 仅本机 Windows Chrome 三流程；网络是否无代理未核实 | 尚未完成 |

以上是内部验收要求，不是已核实的官方评分细则。资金安全模块负例通过不代表集成验收全部通过，也不构成绝对安全声明。

## 安装、隔离演示与复测

本轮运行环境 Node 24、Python 3.13；Finance 虚拟环境使用 PyYAML 6.0.3、numpy 2.2.6。在仓库根目录，依赖安装遵循各模块 lockfile 与 qiqi 要求。Risk adapter 使用 `npm.cmd ci --prefix modules/safety-risk-eval/interface-adapters`。

无模型费用的本机演示：

```powershell
.\qiqi\.venv\Scripts\python.exe qiqi/web/run_competition_demo.py --port 8876
```

打开 http://127.0.0.1:8876/ 。每次启动默认生成新的 competition-demo-* 临时目录，不读取原演示私有账本。打印 state_directory；需要恢复本次演示时显式传 --state-dir。它清空进程内模型密钥配置并封闭 Core review；只监听 loopback。界面 reset 清除审批/纸交易但保留长期记忆；要完全干净的数据与记忆，停止后不带 --state-dir 重新启动。不要删除他人的数据目录。

回归与证据命令（PowerShell，仓库根目录；报告输出文件必须不存在）：

```powershell
npm.cmd test --prefix chenchen
npm.cmd run check --prefix chenchen
Push-Location qiqi
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -q
.\.venv\Scripts\python.exe -m unittest tests.test_preview_contract tests.test_bill_import -v
Pop-Location
$riskTests = @(rg --files modules/safety-risk-eval/test team-staging/risk/long-text/test modules/safety-risk-eval/hosting/test docs/safety-risk-eval/contracts/tests modules/safety-risk-eval/interface-adapters/test modules/safety-risk-eval/joint-acceptance/test | Where-Object { $_ -match '\.(test\.cjs|test\.mjs)$' })
node --test $riskTests
node modules/safety-risk-eval/hosting/build.mjs --check-only
node modules/safety-risk-eval/hosting/check-long-text-worker.mjs
node --check qiqi/web/static/app.js
node modules/safety-risk-eval/joint-acceptance/run.cjs --current-source --out current-joint-report.json
$env:PYTHON_EXECUTABLE = (Resolve-Path 'qiqi/.venv/Scripts/python.exe').Path
node modules/safety-risk-eval/joint-acceptance/verify-current-http.cjs --out current-three-service-report.json
```

HTTP harness 自动启动/关闭临时本机服务，不部署 Worker。Core handler 和 Risk 业务代码为实际代码；模型、Core 存储和批准身份是测试替身。报告随运行生成随机 task_id，比较源码哈希与断言结果，不能要求编号相同。

## 服务端配置与 staging 门槛

| 服务 | 变量/模板 | 配置要求 |
| --- | --- | --- |
| Core 百炼 | chenchen/wrangler.bailian.example.toml | MODEL_PROVIDER=aliyun_bailian、MODEL_NAME=qwen3.8-flash；北京业务空间经账户核验；收费总额/每日默认 0、ALLOW_PAID=false |
| Core Secret | DASHSCOPE_API_KEY、CORE_AGENT_API_KEY、签名密钥见 Core 文档 | 服务端私密录入，不进入前端或仓库；不复用截图旧 Key |
| Finance → Core | CORE_AGENT_BASE_URL、CORE_AGENT_API_KEY、CORE_AGENT_TIMEOUT | URL 仅 origin；远程 HTTPS，本地仅 loopback HTTP；Key 为机器凭据 |
| Finance → Risk | RISK_CONVERSATION_BASE_URL、RISK_CONVERSATION_API_KEY | 机器鉴权；详见 risk_conversation.py 与桥接说明 |
| Risk → Core | CORE_AGENT_BASE_URL、CORE_AGENT_API_KEY、RISK_SERVICE_HMAC_SECRET、RISK_REVIEWER_ID | 签名者须在 Core 信任范围；拒绝空配置、未知回调或结果 |

模型与费用说明见 [百炼接入准备](../../chenchen/docs/bailian-upgrade-2026-10-25.md)；Risk 环境/启动见 [签名回调接入](../safety-risk-eval/对话风控与正式回调接入-v1.0.md)。不把个人 Worker 的 Secret 误当团队 staging 配置。当前未定位 LLM_A_API_KEY 绑定的实际源码，也未取得团队部署权限。

部署由各 Owner 在既有 staging 项目进行：先记录当前部署 ID/SHA 与回滚目标，核实 Secrets/地域/余额/预算，执行 dry-run，再进行明确授权的 staging 部署与三场景验收。当前未实施。生产发布另行确认。回退需恢复该环境实际上一稳定部署，不凭仓库 main 猜测线上版本；代码回退不抹除账本/审计，也不撤销已发生的沙箱效果。

## 阻塞清单与下一步

| 唯一 Owner | 阻塞与影响 | 下一步 |
| --- | --- | --- |
| 理想 | 主聊天源码、团队 staging 权限缺失；无法完成 #14 | 提供正确源仓/授权，接入现有后端契约，发布并验收 |
| 林粹 | 新密钥/空间权限/余额/收费预算未齐；无法真实推理和费用对账 | 核实账户；预算获批后最小调用；复核流式/结构化/工具支持 |
| 七七 | 多用户隔离与统一账本未完成 | 明确账户/模式边界，消除不同夹具被当同一余额；回归 #11 |
| Vesper | 真实用户批准与持久化集成未验 | 在 staging 重跑未批、改参、故障、重放与回调签名负例 |
| Sean | 正式提交材料、精确截止时间、跨平台/大陆直连未验 | 取得报名后台材料并排期，10 月 30 日冻结前收齐证据 |

## 5 分钟视频脚本草案

拍摄条件是上述联调完成后的 staging。当前只有本地分模块与替身集成素材，不能包装成真实线上闭环。

0:00—0:35 主聊天入口，虚构资料/模拟资金标识与三场景。0:35—1:30 持仓工具算出的金额/权重、风险与模拟计划。1:30—2:20 上传两份账单，显示不同批次与净额一致。2:20—3:25 张伟 700 元转账，展示具体对象/金额/备注、确认和一次模拟回执。3:25—4:15 投资 8,000 与受保护用途冲突被 BLOCK；重发已完成操作无二次扣减。4:15—4:50 同一任务的工具、风险、批准、执行与审计。4:50—5:00 版本、来源与边界。每段来自实际录屏。

## 10 分钟答辩提纲草案

0—1 分钟：用户问题与三场景。1—2：实际系统图和唯一 Owner。2—4：模型解释与确定性计算、账单退款口径。4—6：权限、Risk、人审与计划版本。6—7：沙箱执行、幂等、审计和记忆范围。7—8：真实模型、费用预算及对账（未完成时直说）。8—9：正常、需审批、阻断、故障及设备证据。9—10：已知边界、计划和问答。最终格式以报名后台及正式附件为准。
