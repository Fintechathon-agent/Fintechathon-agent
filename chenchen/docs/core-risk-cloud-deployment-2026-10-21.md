# Core 与 Risk 已部署：2026-10-21

## 先看结论

**已实际部署到 Cloudflare，并完成 14 项公网检查；这是独立后端联调版，不是整套产品已验收。**

- [Risk 联调说明页](https://finance-lab-risk-bridge.realchenchenluo.workers.dev/)：给团队看用途和当前边界，不包含输入密钥的表单。
- Risk 后端源站：`https://finance-lab-risk-bridge.realchenchenluo.workers.dev`。
- Core 后端源站：`https://finance-lab-core-risk-validation.realchenchenluo.workers.dev`。
- [Risk 在线状态](https://finance-lab-risk-bridge.realchenchenluo.workers.dev/health)、[Core 在线状态](https://finance-lab-core-risk-validation.realchenchenluo.workers.dev/health)可直接打开。

旧 Core 地址和既有网页保持不变。没有合并 PR #27／#28，没有修改其他 Owner 的源文件、公共 Schema、Memory 规则或 `team-release/`。新服务带独立持久化，不读取或迁移旧任务。

## 现在能做什么

| 能力 | 实际结果 |
| --- | --- |
| 公网后端 | 两个 Worker 已部署，健康检查均为 200 |
| Risk → Core | Risk 在 Cloudflare 服务端实际发起 HTTPS 请求，Core 验证机器凭据后返回能力状态 |
| 资金核对 | 现金 10000、保护房租 4000、拟投入 8000：程序判定 BLOCK，缺口 2000 |
| 重复／改资料 | 相同请求复用记录；同编号改内容返回 409 |
| 审计 | Cloudflare SQLite Durable Object 保存检查、事件编号和哈希链，可由授权服务端查询 |
| 回调身份 | 错签名 401；签名正确但审核身份不符 403；正确身份＋签名但任务不存在 404 |
| 费用保护 | Risk 完整模型入口返回 423 `MODEL_CALLS_DISABLED`；新 Core 故意不绑定 AI；未进行真实模型调用 |

最后一项签名测试只证明验证门禁正常，**不是对真实业务任务成功回调**。缺口结果是程序计算，不是模型响应；没有把离线文字伪装成模型结果。

## 团队后端怎么调用

所有 `/api/*` 路径要求服务端请求头 `X-Risk-Conversation-Key`；不要把这个凭据写进浏览器、URL、聊天或仓库。来自浏览器的 `Origin` 请求会被拒绝，也没有开放 CORS。它不是最终用户登录系统；目前仅供团队受信任后端联调，不适合直接开放真实用户账户。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/status` | 检查 Risk 到 Core 的网络与机器鉴权；不会调用模型 |
| `POST /api/assess` | 仅用原 Risk 规则分析虚构资金；不生成 Core 任务、不正式回调、不执行 |
| `GET /api/records/{idempotency_key}` | 查看 `/api/assess` 的持久记录和审计链；不是完整 Core 任务查询 |
| `POST /api/review` | 完整模型→Risk 回调适配入口；目前按费用要求关闭，不可用返回 423 |

`POST /api/assess` 的请求样例（金额保留十进制字符串，不能擅自将未知值填 0）：

```json
{
  "question": "虚构测试：再投8000元是否影响下月房租？",
  "idempotency_key": "team-check-example-0001",
  "daily_finance_yuan": {
    "cash_yuan": "10000", "amount_yuan": "8000",
    "fees_yuan": "0", "holds_yuan": "0", "floor_yuan": "0",
    "purpose_yuan": "4000", "due_yuan": "4000",
    "due_date": "2026-11-01", "purpose_label": "房租",
    "facts_confirmed": true, "purpose_confirmed": true
  }
}
```

服务端设置 `Content-Type: application/json`。新的一次业务检查使用新请求编号；重复同一检查复用编号，内容变化不能复用。成功响应明确标记 `decision_source=PROGRAM_ONLY`、`model_status=NOT_CALLED`、`formal_risk_callback=NOT_SENT`、`execution_allowed=false`。

## 密钥与运行保护

机器访问、Risk HMAC、Risk 入口访问分别为独立随机值。Core 与 Risk 所需相同项已分别上传 Cloudflare Secrets，未写入配置文件、报告或 Git。服务身份固定为 `risk-conversation-cloudflare-v1`，Core 严格验证开关已开启。

本机恢复副本保存在当前 Windows 用户的 `%LOCALAPPDATA%/FinanceLabDeploy/risk-validation-secrets.dpapi`，由 Windows DPAPI 加密，仅同一 Windows 用户可解密。不要把该文件或明文发群。其他成员运行后端时须由部署负责人通过团队认可的保密渠道配置服务端凭据；Cloudflare Invite 只授权管理资源，不等于获得业务接口访问权。

SQLite 存储保持单写入队列，调用外部服务前同步已保存的意图；重启遇到 RUNNING 会转为 UNKNOWN，禁止自动重发。联调环境最多保留 1000 个请求、20000 条事件，到达上限阻断，不自动删除。此为小规模联调部署，不宣称是生产级账本或用户身份隔离系统。

## 本轮测试与代码来源

- 原 Core 全量 304/304；新增云适配专项 9/9。
- 专项中的拒绝、等待审批两条完整路径使用测试替身模型和本地 Core Handler，**不是公网真实模型验收**。
- Cloudflare 本地 workerd 实际启动通过；真实 SQLite 存储资金核对和记录查询均为 200。
- 14 项公网检查通过，见[部署与检查证据](core-risk-cloud-deployment-2026-10-21.json)。保留响应哈希、审计事件编号、检查时间和门禁错误。
- [记事本可读的测试摘要](core-risk-cloud-test-results-2026-10-21.txt)不包含任何密钥，便于团队直接查阅。
- Risk 规则、资金计算、回调和审查逻辑来自 PR #27 固定提交 `27bdefbbb38c7d4e7b7dc1f975217862832d1d6f`，不是 Core 自建另一套 Risk。
- 构建时将原 Core 客户端的 Ajv 运行时编译改为同 Schema、同选项的预编译校验器，适应 Workers 禁止动态求值的限制；原文件不修改。另用 SQLite Store 替代本机文件 Store。构建来源哈希随证据保存。

测试期间发现并修复：初次打包的 CJS 内置模块动态 require 无法在 workerd 启动；Windows PowerShell 继承 PS7 模块路径导致凭据加密失败。修复后 workerd 启动及 DPAPI 保存／恢复均通过，未使用明文凭据文件。初次上传后遇到身份未就绪 503，没有将其计为通过；最终重新配置并复验通过。

## 仍需完成，不能对外承诺已完成

1. 费用负责人确认模型测试预算和提供方，再配置 AI 绑定和受限调用开关。本轮没有开通百炼、没有充值、没有调用真实模型。
2. 原问答后端接入这个服务端入口；原 Python 的回环地址保护不能直接改成公网放行，需要对应 Owner 确认代理适配。现有用户页面没有换成新联调后端。
3. 用真实模型提议完成同任务 Handoff、签名回调和核查原文／日志；再补可信人工审批身份与受控 PAPER 网关验收。缺这些条件仍阻断，不能为演示放行。
4. 接入真实用户前补身份与资料隔离、隐私授权、留存策略和共享资金账本；目前只接收虚构案例。

旧 Worker 版本与旧 Git 历史都保留。需要撤回时先停止新请求并核查待处理任务；不要删除存储、不要自动重发 UNKNOWN。新联调域名与旧生产域名隔离，停用新环境不要求覆盖旧生产。
