# Core 与 Risk 回调接线：2026-10-21

## 先看结论

Core 的接收端补丁和本地复测已完成，**还没有部署，也没有完成公网联合验收**。Risk 接线服务当前只在本机，PR #27（`27bdefb`）尚未合并。现有网页不因这份后端补丁自动更新。

现有 Core 后端：`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev`。

只读实查 `/api/review/capabilities` 返回 HTTP 200：模型绑定存在，但没有运行推理探测；Risk 签名、主动派发地址和审批签名均未配置。没有调用真实模型或线上回调。

## 这次补了什么

- 机器访问身份检查在 Node 与 Cloudflare 共用；严格模式漏配身份返回 503，不再匿名接受任务。
- 固定 Risk 审核身份来自服务端 `RISK_REVIEWER_ID`。即使签名正确，换成另一个审核标签仍返回 403。
- 新增 `REQUIRE_RISK_REVIEWER=true` 上线开关。开启后缺审核身份、签名或机器身份都会阻断；关闭时保留旧签名模式兼容，但就绪检查明确不通过。新增配置须 Owner 确认后启用，不暗改冻结接口。
- `/api/review/capabilities` 增加脱敏的回调就绪状态，Node 也提供同一入口。配置齐全仅代表 Core 本侧准备好，不等于对端配置一致或联合验收通过。
- 新增离线配置检查与 PR #27 跨模块复测脚本；在线说明页移除机器密钥输入框，不鼓励把服务端密钥填进浏览器。

没有改动 `model-review.v1`、`risk-handoff.v1`、`risk-callback.v1` 的字段和状态；回调仍是原来的十个字段、六项绑定。没有修改 Risk 规则、Memory 规则、其他 Owner 原代码或现有生产配置。

## 两边需要配置哪些内容

| 配置名 | 放在哪里 | 作用 |
| --- | --- | --- |
| `CORE_AGENT_BASE_URL` | Risk Node 服务端 | 使用上面的 Core 源站，不附路径 |
| `CORE_AGENT_API_KEY` | Core Secret、Risk Node 服务端 | 同一份随机机器访问凭据，不能进浏览器 |
| `RISK_SERVICE_HMAC_SECRET` | Core Secret、Risk Node 服务端 | 同一份独立随机签名密钥，不与机器凭据或审批密钥混用 |
| `RISK_REVIEWER_ID` | Core 变量、Risk Node 服务端 | 双方一致的固定服务身份，不从用户输入取得 |
| `REQUIRE_TRUSTED_ACTORS=true` | Core 变量 | 要求 Owner 签名，缺审批签名时审批继续阻断 |
| `REQUIRE_RISK_REVIEWER=true` | 本补丁部署后的 Core 变量 | 要求固定 Risk 审核身份，不允许退回无签名演示 |
| `RISK_CONVERSATION_API_KEY` | Python、Risk Node 两个服务端 | 两个本机进程间的访问凭据，遵循 PR #27 至少 24 个 ASCII 非空格字符要求 |
| `RISK_CONVERSATION_BASE_URL` | Python 服务端 | 本机连接一般为 `http://127.0.0.1:8790` |

建议机器访问和签名密钥分别使用密码管理器生成的至少 32 字节随机值。不要发聊天、写入公开 `.env` 或 `wrangler.toml`、提交 GitHub、放进 URL 或打印到测试报告。

Cloudflare Secret 可以在 Worker 的 Settings → Variables and secrets 中设为 Secret；命令行也支持 `wrangler secret put` 的交互式输入。`secret list` 只列名称，不读取值。[官方 Secret 命令实现](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/secret/index.ts)。

这套机器间验证不以开通 Cloudflare Access 为前提。Access、CORS 和机器身份是不同层次：CORS 与账户 Invite 都不能代替机器访问凭据和回调签名。

## 推荐顺序：先本机联调，再切生产

1. 由对应 Owner 确认本补丁和 PR #27；先使用独立验证环境或双方本机环境，不直接在现有生产 Worker 上启用新身份。
2. 在双方服务端安全配置上表。生产会启用机器身份后，浏览器直接调用会返回 401；因此必须先接好 Python → Risk Node → Core 的服务端代理，再切正式流量。不能把密钥补进前端来解决 401。
3. 在仓库根目录运行 `node chenchen/scripts/check-risk-callback-config.js`。它只检查**当前进程环境**，不读取 Cloudflare 远程 Secrets、不联网、不调用模型；退出码 0 为本侧配置齐全，2 为仍有缺项。不要把本机检查误称为线上配置成功。
4. 使用 PR #27 的锁定依赖安装与启动说明运行原 Python 问答服务及 Risk Node 接线服务。该 Node 服务默认只监听回环地址，不能直接把它标作已部署公网服务；Cloudflare Workers 也不能原样运行它的 `http.server`／本地文件持久化代码，需要部署适配和持久化方案。
5. 本轮使用的是 **Risk 服务端拉取 Core Handoff，然后签名回调**。这条路径不要求 Core 配置 `RISK_SERVICE_URL`；只有改成 Core 主动派发时才需要该公网地址和相应接收端。不要把本机 `127.0.0.1:8790` 填作云端主动派发地址。
6. 先复跑本地替身测试；真实模型调用须另行确认费用预算。随后按同一任务编号、方案指纹、风险结果、审批状态和审计记录完成真实服务联合验收。

## 验收时看什么

| 场景 | 正确表现 |
| --- | --- |
| 可用现金 10000、保护房租 4000、拟投入 8000，费用和其他占用已确认 0 | 程序缺口 2000，Risk 拒绝；没有执行回执 |
| 同一资金安排改为投入 2000，必要资料齐全 | Risk 通过后等待人工审批，不显示已成交 |
| 费用等必要事实未填 | 提示补资料，不擅自补 0，不执行 |
| 机器身份缺失、签名错误或审核身份不符 | 明确失败，不改变原任务风险决定 |
| 签名正确但任务编号或方案指纹串单 | 拒绝并保留原任务和阻断记录 |
| 相同请求／相同回调重试 | 复用原模型任务／决定，不新增副作用 |
| 回调超时或回执不可确认 | UNKNOWN，先核查原任务，不盲目重发 |
| 模型失败 | 失败记录保留，不换测试文本冒充模型成功 |

Risk 通过不等于人工批准，更不等于执行；审批缺配置、被拒绝或等待期间都不能执行。真实执行网关仍未接通，本轮始终 `execution_allowed=false`。

## 本轮证据与复跑

- Core 全量 Node：304/304，包括新增安全与本机 HTTP 检查 20 项（属于 304 内，不重复相加）。
- PR #27 原始 Node：258/258；独立临时快照测试，没有修改或合并 Risk Owner 文件。
- PR #27 Python：16/16。首次环境缺 PyYAML 导致 4 项导入错误；隔离安装其指定 `PyYAML==6.0.3` 后通过。
- PR #27 原始静态样例：4 个回调样例、12 个金额向量校验通过。
- 新跨模块验证：5/5，PR #27 真实适配代码调用实际 Core Worker Handler；传输为进程内 Fetch，不是公网 HTTP，模型为明确替身。
- PR #27 原始 Python→Node 本机 HTTP 辅助脚本通过：房租例缺口 2000、签名回调已记录、重复请求仅一次替身模型调用。辅助脚本的 Core 传输仍是测试 Fetch，不是线上 Core 验收。
- 新验证保存了模型替身原文、任务／运行／审计编号、方案指纹和审计事件：[JSON 记录](risk-callback-readiness-2026-10-21/pr27-core-bridge.json)。
- [验证过程与限制](risk-callback-readiness-2026-10-21/results.json)保留中途失败原因，不只保留最终通过数字。

在已检出的 PR #27 快照目录或包含相应模块的团队检出目录上复跑：

```powershell
# 参数是快照的仓库根目录，不能传 interface-adapters 子目录
node chenchen/scripts/verify-pr27-risk-bridge.mjs C:/path/to/pr27-snapshot
```

所有以上自动化模型均为测试替身；本轮真实模型调用 0 次、真实资金动作 0 次。网页更新、真实模型验收、线上签名回调、人工审批身份与最终联合验收仍待推进。
