# Core Agent 百炼接入记录 · 2026-10-17

本轮依据指定的阿里云百炼方案实现后端适配，范围为 Core Agent 模型接入、调用控制和验收准备。**没有开启或执行任何百炼付费测试，也没有把线上模型切换为百炼。**

## 已实现

- 新增 `MODEL_PROVIDER=aliyun_bailian`（也接受 `bailian`）。默认模型为 `qwen3.7-flash`，支持明确的同系列日期快照；只接受北京业务空间专属地址。
- 使用现有 `/api/review` 请求与响应。JSON 格式、模型建议、Risk Handoff、审批、模拟执行、审计链路保持既有接口。没有修改公共 Schema、Risk 状态或 Memory 规则。
- 模型密钥只读 `DASHSCOPE_API_KEY`，不会借用其他供应商的密钥。工作空间、地址、模型、协议和输出设置不匹配时在 HTTP 发送前阻止调用。
- 关闭深度思考、关闭流式输出，输出最多 1600 tokens；单次请求正文最多 24000 UTF-8 字节；最多两次尝试，共用调用超时预算。无自动切换供应商或规则伪装成功。
- 百炼模式强制要求后端访问凭证。全局每分钟最多六次模型尝试，队列最多八个未完成请求；预算占用和尝试次数持久化，进程重启不会清零。
- 运行日志记录 run_id、尝试编号、供应商响应编号、耗时、token 用量、失败代码；不写密钥和原始用户文字。完整任务响应仍按现有机制保存在审计记录中。
- 新增配置预检查、禁用付费的配置样例、开通指引、测试输出和临时共创交付说明。旧版本及其他模块继续保留。

[通俗开通指引](bailian-setup-guide-2026-10-17.md) · [共创交付入口](../../team-staging/core-agent/bailian/DELIVERY.md)

## 状态分层

| 项目 | 当前状态 | 证据或缺口 |
| --- | --- | --- |
| 模拟验证 | 本地 166/166 测试通过，语法检查通过 | [原始测试日志](bailian-local-tests-2026-10-17.txt)，新增 13 项百炼相关测试；所有供应商 HTTP 都用替身 |
| 后端编译 | 百炼配置的 dry-run 构建通过 | 不上传配置，不发送模型请求 |
| 真实百炼 | 未接通、未测试 | 业务空间、Key 未配置；付费开关为 false、预算 0 |
| 国内网络速度 | 未测试 | 没有真实端到端模型测量，不能拿本地测试毫秒数或健康检查替代 |
| 联合验收 | 未完成 | 真实账户、工具服务、身份审批、Risk Owner 接入仍需对应模块一起确认 |
| 线上现有服务 | 保持 Workers AI 配置 | 本轮后续仅做健康检查，不进行收费模型调用；部署证据见独立记录 |

本地测试中的 `call_succeeded=true` 仅表示测试替身返回成功；不代表向阿里云发过请求。

## 图中六类最低验收的覆盖情况

| 场景 | 本轮本地覆盖 | 正式验收还缺什么 |
| --- | --- | --- |
| AI 正常对话 | 现有 review 流程接受模拟 JSON，保留响应和 token 用量 | 实际千问响应与上下文表现；当前不是通用聊天接口 |
| 账户查询 | 无可信账户输入时保留补充资料状态，不能当已查到余额 | 真实身份校验、账户数据接口、无权限/空账户/过期数据用例 |
| 工具调用 | review 收到未授权 tool_calls 不执行；旧工具及主链路回归测试通过 | 千问自主选择只读工具及正式工具响应的正向联合测试尚未完成 |
| 风控拒绝 | 模拟 Risk 拒绝后不可模拟执行；任务与审计关联保留 | 正式 Risk 服务与签名验证联调 |
| 接口超时 | 请求中止、有失败记录、预留额度不返还、不自动换模型 | 实际服务网络超时表现 |
| 连续并发 | 全局额度预留串行化、并发限额、重启后仍保留用量 | 国内客户端真实并发延迟、成功率与服务端负载记录 |

不把“拒绝工具越权”的测试写成“真实工具调用已接通”。

## 调用与部署配置

维护文件：`chenchen/integrations/bailian-provider.js`、`bailian-budget.js`、`model-review.js`、`deployment/worker.js`。

[配置样例](../wrangler.bailian.example.toml) 当前故意禁用调用，不能直接覆盖可用线上配置。准备切换时可复制为已忽略的 `wrangler.bailian.local.toml`，先填业务空间 ID，安全设置服务端密钥，确认预算，再 dry-run、验收、切换。同一个 Worker 的 Durable Object 继续使用，不删除旧任务。

| 配置名 | 含义 |
| --- | --- |
| MODEL_PROVIDER | aliyun_bailian |
| MODEL_NAME | qwen3.7-flash 或已核实日期快照 |
| BAILIAN_WORKSPACE_ID | 北京业务空间 ID，不是显示名称 |
| DASHSCOPE_API_KEY | 加密保存的北京空间模型 Key |
| CORE_AGENT_API_KEY | 团队后端调用凭证 |
| BAILIAN_ALLOW_PAID_CALLS | 默认 false，当前保持关闭 |
| BAILIAN_TEST_BUDGET_CNY | 默认 0，当前未批准付费；试验配置最大支持 5 |
| BAILIAN_MAX_OUTPUT_TOKENS | 默认 1600，不能超过 1600 |
| REQUIRE_TRUSTED_ACTORS | 百炼样例设为 true；未配置真实审批/风控签名时不放行 |

预检查：在 `chenchen/` 执行 `node scripts/bailian-preflight.js`。仅检查当前进程环境变量，不自动读取 Wrangler 配置、云端 Secret 或 dotenv 文件；不联网、不打印密钥。未准备好返回退出码 2。Node 本地服务器尚未接持久化百炼预算存储，会明确阻断；当前接入目标是现有 Cloudflare 后端，不能把配置直接搬到本地服务宣称可用。

## 预算与日志如何理解

每次真正发 HTTP 前先保守占用 0.01 元试验额度。额度累计不自动按天清零；超时、供应商错误和重试也计入占用，重复成功任务不会再调模型。存储不可用时不开始调用。预算超限使用现有 RATE_LIMITED 错误，失败任务可查。

0.01 元是短输入、有限输出下的保守预留单位，**不是账单金额，也不是阿里云侧的硬性消费封顶承诺**。实际费用以阿里云账单为准；模型价格、快照和输入边界变化时需要重新核算，另在阿里云空间设置模型限流、token 限流和费用提醒。[模型能力与定价依据](https://help.aliyun.com/zh/model-studio/qwen3-7-flash)

每次尝试在 Durable Object 的 `bailian-attempt:<run_id>:<attempt>` 保存内部记录，预算汇总在 `bailian-budget:v1`。控制台日志事件名 `bailian.attempt`，含 token、耗时和响应编号；没有返回的用量是 null，不是 0。RESPONDED 仅指供应商 HTTP 返回，仍需看任务记录确认 JSON 是否有效及 Risk 是否通过。

只有账号设置的审核人员应查这些服务端日志；前端不直接读取密钥或内部预算账本。

## 文档依据与回退

按 [官方首次调用说明](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)、[Chat 接口参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/) 核对北京专属域名、json_object、enable_thinking=false 与 max_tokens。这是兼容接口适配，未使用 OpenAI 服务。

团队代码基线 `eddae8b093813cf8c32ed8aba979a7e9ca51ef08`，个人代码基线 `8ac2e5f7f4cfed8583540a709e3a25e2298fc7d9`；上一线上版本 `5ddf34f5-21cc-4505-8cbb-1946cf73070c`。不删除旧版本或数据；需要回退时从这些提交建恢复分支，或恢复对应 Cloudflare 版本，不强制改共享历史。

## 今日 Update 补充

已完成：百炼适配、默认禁用付费、持久化预算与用量、模拟验收和开通文档。
可验证进度：166 项本地测试通过，百炼配置编译通过，真实百炼测试次数为 0。
阻塞项：账号与北京业务空间未开通，专用 Key 未提供安全配置，费用尚未授权；真实账户、工具与 Risk/审批仍待 Owner 联调。没有把本轮称为正式接通或联合验收。
