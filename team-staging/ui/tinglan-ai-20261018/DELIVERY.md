2026-10-20 最新：独立分享 Worker 的真实 Flash 后端及网页链路均已通过；大陆直连仍未通过。详见 [CLOUD-VERIFICATION-2026-10-20.md](CLOUD-VERIFICATION-2026-10-20.md)。以下均为历史交付快照。

# 听澜真实 AI 接入候选 · 2026-10-18

2026-10-19 第二轮：投资金额/目标/风险偏好及完整分析已补齐；指定大学生场景一次真实调用 HTTP 200、1148 tokens，完整结果与网页一致。新增报告 [PREFERENCE-ACCEPTANCE-2026-10-19.md](PREFERENCE-ACCEPTANCE-2026-10-19.md)。云端部署仍被 Owner 登录/Access 配置阻塞，下文和上一轮报告为历史快照。

2026-10-19 更新：两次授权的本机真实百炼调用成功，Worker dry-run 和本地 workerd 启动通过；公网仍运行 Llama，尚未完成 Cloudflare Access / Secrets / 真实云端链路验收。最新证据与 Owner 操作见 [ACCEPTANCE-2026-10-19.md](ACCEPTANCE-2026-10-19.md)。下文保留原交付快照，其中“付费调用 0 次 / 编译未通过”仅指 10 月 18 日当轮。

状态：前后端 Mock 联调完成；等待 Cloudflare Owner 配置、审核部署与付费测试授权。当前不是已上线的百炼服务。

个人预览分支 preview 已推送 1abdbba345306c7f5a072cd88a48456431a88b64，入口：https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html#ai-assistant 。默认未配置付费入口。

## 已核实的现状与报错

团队基线为 922d8a34d54c862d0353b14bb3a01ceba67b2476。现有 chenchen/deployment/worker.js 已部署，复用 POST /api/review、ReviewWorkflowStore、BailianBudget 与 SQLite Durable Object；没有另建云服务器或模型后端。

2026-10-18 浏览器 GET https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health 返回 200，约 1922ms。当前 provider=cloudflare_workers_ai，model=@cf/meta/llama-3.3-70b-instruct-fp8-fast，audit_storage=durable_object。此前 Node 直连 GET/OPTIONS 失败；连接质量存在不确定性，不能声称大陆稳定可达。本轮没有发送公网推理请求。

历史 publicAccessEnabled 报错来源：旧 build-static.cjs 用字符串截取 server.js 的 handleApi，新增本机 /api/review 后将依赖服务端 publicAccessEnabled、request.socket、reviewService 的路由带进浏览器。ReferenceError 被 sendError 的默认 400 映射掩盖。上一轮已剔除该路由，并拒绝含服务端依赖的静态构建。本轮听澜在静态适配器加载前保存原生 fetch，使用真正网络通道，不经过静态 /api/review 的 503 模拟响应。

这解释了该旧产物的报错机制，不意味着所有 HTTP 400 都是这一原因。非法 JSON 仍应返回 400；缺少 text、无效 kind 等属于输入错误；旧 question 输入只适用于 /api/review/legacy。本轮没有原始旧故障网络录制，不把推断写成历史实测。

本地 chenchen/.env.local 已存在且被 Git 忽略。只检查存在性和非敏感字段：MODEL_API_KEY 已填写，MODEL_NAME=qwen3.8-flash，MODEL_PROVIDER=http，完整地址为北京专属域名的 /compatible-mode/v1/chat/completions，关闭规则回退。现有团队百炼适配器读取 DASHSCOPE_API_KEY 并要求业务空间及持久预算，不能直接把本机配置搬到 Worker。未输出密钥或完整空间地址。

## 本轮代码

- frontend/ 与 public/investment-only/：投资期限、可承受回撤、资金需求、文本输入；加载与错误状态；真实模型证据、Token 与审计编号展示。明确只接收本轮虚构示例。原确定性计算仍可产生三个方案，和 AI 结果分开。
- access.mjs：验证 Access RS256 签名、issuer、audience、有效期、账号白名单，不信任单独的用户身份 Header。只缓存公钥，不记录 JWT。
- gateway.mjs：同一 /api/review 的浏览器入口；仅在 Access 验证后注入服务端 CORE_AGENT_API_KEY。限制来源、JSON 大小与字段，绑定身份和幂等键，拒绝用户传入任务/审批权限；错误使用中文白名单，返回时脱敏。
- worker-entry.mjs：包装原 Worker，并继承现有 ReviewService。复用原有串行队列，在模型之前持久化每用户限额（每天默认 5 次，每分钟 2 次）；保留全局每分钟六次模型尝试、并发排队上限与总预算。
- prepare.cjs：从指定 Git 基线在系统临时目录重建独立候选，只在临时副本增加精确 qwen3.8-flash 白名单及响应模型身份校验。没有改团队根目录后端。对应 Owner 提案见 docs/contract-proposals/。
- wrangler.example.toml：延用同一 Worker 名称、ReviewService 绑定与原迁移标签，付费 false、预算 0、最多一次尝试、输出 800 tokens。不含密钥。

原 CORE_AGENT_API_KEY 的机器调用仍走既有契约；Access 浏览器用户只允许新建只读 review，不开放审批、模拟执行或其他人的任务查询。Access 不是完整业务 RBAC，本轮没有声称实现账户权限体系。

## 如何验证（不付费）

在仓库根目录生成临时副本：

```sh
node team-staging/ui/tinglan-ai-20261018/prepare.cjs
```

进入输出 candidateRoot 执行候选测试；进入其 chenchen/ 执行原回归：

仓库内测试源保存为 .source 后缀，避免团队根目录自动测试发现未准备的隔离副本；prepare.cjs 会恢复可运行名称。

```sh
node --test team-staging/ui/tinglan-ai-20261018/tests/gateway.test.mjs
cd chenchen
node --test
```

浏览器测试需安装 Playwright 并可使用 Chrome；测试程序在本机启动 HTTP 服务，把供应商 fetch 全部替换为 Mock，输出含 MOCK 标记：

```sh
node team-staging/ui/tinglan-ai-20261018/tests/browser.cjs
```

结果：新增 11/11、原回归 249/249；1440/1024/375px 正常链路和鉴权、限流、超时、非法 JSON、网络失败、供应商鉴权、未配置等七类失败通过。测试验证真实 HTTP 传输到本机候选，再由 Mock 供应商响应；真实百炼付费调用数为 0。浏览器证据见 evidence/browser-mock.json。

## Owner 必须完成

1. 确认拥有现有 Worker 与 Zero Trust 管理权限，审核提案和隔离候选。当前机器未找到可用 Wrangler 登录配置；没有据此断言用户账号一定无权限。我们没有登录或修改团队 Cloudflare。
2. 审核 prepare.cjs 的两项最小后端修改：放行明确模型 qwen3.8-flash（仍保留 3.7 系列），校验供应商响应 model；再把 wrapper 纳入同一 Worker 的入口。不要将旧本机 http provider 覆盖团队百炼适配器，不绕过预算。
3. 备份现有 Wrangler 配置、Worker version 和 Secrets 清单。采用示例配置时保留真实 account_id、绑定与原迁移记录；使用同一个 Worker，不重建或删除 Durable Object。先 dry-run 编译，再由 Owner 发布。本轮尝试本地 dry-run，但 workerd Windows 依赖下载失败，未获得编译通过证据；没有部署。
4. 在 Worker Settings → Variables and Secrets 增加加密 DASHSCOPE_API_KEY、CORE_AGENT_API_KEY。前者对应本机 MODEL_API_KEY 的百炼 Key；后者是独立服务凭证，不能发给浏览器。CLI 可交互执行 wrangler secret put，不将值放命令行、聊天、配置或 Git。
5. BAILIAN_WORKSPACE_ID 从已有北京完整 Host 取得，仅因现有专属域名适配器需要。不要二次追加 /chat/completions，不猜 WorkspaceId；MODEL_API_URL 可不设，若设置必须是同一个完整 URL。模型以该账号已验证的 qwen3.8-flash 为准。
6. 使用团队受控 HTTPS 自定义域名与 Access 应用，Allow 策略只允许指定组员；配置 ACCESS_ISSUER、ACCESS_AUD、ACCESS_ALLOWED_EMAILS。禁止 Everyone/Bypass。同一应用应覆盖 /investment-only/*、/api/review* 与 /api/tinglan/*，或使用整个专用域名，让用户打开工作台时先完成登录；OPTIONS 可以不做 Access 登录，但 Worker 仍精确检查 Origin。禁用 workers.dev，防止绕过入口。Owner 须为既有机器调用保留受控的 Service Auth 策略，不让新增 Access 策略中断其他模块。
7. 推荐用此 Worker 的 ASSETS 同源托管 public/，地址 /investment-only/investment.html；前端配置由 Worker 返回 /api/review。这样登录和请求同域，避免 GitHub Pages 跨站 Cookie 被浏览器拦截。GitHub Pages 保存预览与入口，Owner 提供实际安全 URL 后再把跳转入口写入 Pages。若坚持跨域请求，须实测 Access Cookie、精确 CORS Origin 与 Allow-Credentials，不能使用 *，不能把 CORE_AGENT_API_KEY 写在 JS。
8. 先保持 BAILIAN_ALLOW_PAID_CALLS=false、BAILIAN_TEST_BUDGET_CNY=0。验证未登录拒绝、合法登录、配置检查、存储失败、额度保护与日志；不要为了验证登录直接调用模型。已有 /health 的 configured 不代表推理成功。
9. 取得本轮费用确认后，限制 MODEL_MAX_ATTEMPTS=1、BAILIAN_MAX_OUTPUT_TOKENS=800，批准最多 2 次短文本冒烟，先累计预留 0.02 元。全局预算按每次 0.01 元保守预留且失败不退回；这是应用试验限额，不是阿里云账单硬封顶。用量持久记录；另设置账号费用提醒。试验后关闭付费或重新审批预算。
10. 在中国大陆实际电信/联通/移动网络各测健康检查和已授权完整分析，记录地区、运营商、时间、HTTP、耗时、模型、Token、错误率。当前环境网络出口未独立核实，不能替代这些实测。若 workers.dev 不稳定，先验证同一 Cloudflare 后端的受控域名，不擅自迁往其他云。

## 冒烟费用与验收

拟用 qwen3.8-flash，最多 2 次（接口一次、浏览器一次），每次短输入目标不超过 3000 tokens、输出上限 800，无自动重试。北京官方价输入 0.8 元/百万、输出 2.7 元/百万，按该输入量约 0.00912 元/两次；预计约一分钱，建议预留 0.02 元，实际费用以账单为准。需在配置可用后重新确认执行，本文不构成已获付费授权。

验收须同时满足：公网受保护入口可达、未登录不能调用、付费总额保护有效、实际 qwen3.8-flash 响应与 Token 可查、浏览器显示相同结果、异常安全失败、日志无密钥。不以 Mock 成功代替真实成功。

## 回退与同步

Owner 记录并恢复上一 Worker version 与配置；保留现有 Durable Object 数据，不清空预算记录。个人仓库回退本轮预览提交即可。团队仅新增 team-staging/ui/tinglan-ai-20261018/，不修改 team-release 或根目录业务源码；以草稿 PR 审核，不直接合并 main。旧 finance-lab-demo 不同步。

## 官方依据

- 模型 ID 与北京定价：https://help.aliyun.com/zh/model-studio/qwen3-8-flash
- Access JWT 验证：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Access 应用 Token：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Worker 同源静态资源：https://developers.cloudflare.com/workers/static-assets/binding/
