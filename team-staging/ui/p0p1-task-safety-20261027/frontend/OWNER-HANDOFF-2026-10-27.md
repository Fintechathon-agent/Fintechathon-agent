# Owner 联调与比赛演示交接

本轮前端适配既有契约，不增加后端字段或路由，不接收机器凭据、不签署风控、不代办审批、不执行资金操作。

## 现有接口对应

| 服务 | 方法/路径 | 契约/用途 | 浏览器接入条件 |
| --- | --- | --- | --- |
| Core | POST `/api/health-check/run` | investment-agent.v1；固定演示诊断 | 同源受保护服务；保留原请求和返回的任务编号 |
| Core | GET `/api/task/{task_id}`、`/api/audit/{task_id}` | 恢复已知健康任务及真实事件 | 只能恢复可查询任务；不宣称全量列表或生产持久化 |
| Core | GET `/api/review/task/{task_id}` | review-workflow.v1；九态/风控/审批/模拟回执只读 | 正式云端要求服务端代理和授权会话；前端不携带机器Key |
| 本机候选 | GET `/api/assistant/state`、`/api/demo/portfolio`、`/api/assistant/workspace/state` | 自述预算、固定持仓、隔离候选 | 不是正式身份、Risk或资金账本 |
| 本机候选 | POST `/api/assistant/workspace/analysis`、`/task` | 既有只读千问分析、资料核对待办 | 本轮保留原接口；用户授权、来源版本和幂等行为仍由原后端验证 |
| Finance | `/api/scenarios/*`、GET `/api/audit` | 独立 Finance 契约，金额单位元 | 本轮只读研究；不与Core同名接口混用 |
| Risk 云联调 | `/api/status`、`/api/assess`、`/api/records/{id}`、`/api/review` | 服务间接口 | 不能浏览器直连；没有新建猜测的 `/api/risk/*` |

## 不能由前端补造的阻塞

1. 林粹/架构/组长确定哪个候选分支是联合验收基线、部署 SHA 和同源代理 Owner；现有三个 `/api/review` 不能互换。当前公网 Core/Risk 未向本页提供已验证用户代理；只读401保留。
2. 李想/审批 Owner确定最终用户身份、完整计划版本绑定和批准期限。Core现有服务签名验证不等于可信最终用户确认；`confirm()`与资料核对待办均不能授权交易。
3. Vesper确认 Risk Owner身份、原规则/证据、风险决定与 Core计划摘要的关联；已有 frozen callback只消费其允许的字段。本轮不给旧Contract塞入subject/account/nonce等提案字段。
4. Finance Owner提供唯一可信账本、归属与账户版本，明确整数分/十进制元、保护用途和并发预留/提交/释放责任；目前不拿自述预算充当可用资金。
5. 模型费用 Owner确认新的 qwen3.8-flash受限真实调用预算与入口。当前只读健康证明已配置；本轮没有新调用，不切换其他模型。
6. Core/Audit Owner说明任务与审计查询的持久性和原请求未知状态恢复；没有 request_id 查询路径时，保留关联号并由Owner核查，不新造端点。
7. Finance Owner修复既有日期回归：2026-10-27运行时，`test_explicit_date_still_works`仍固定期待2026-10-25。原代码只读，证据在finance-tests.txt。

## 可运行演示

用途：仅打开本机静态候选，不调用付费模型。

```powershell
npm run preview
```

用途：运行已有Core确定性演示，再由本机UI工具代理有限的既有路径。不要加载任何环境密钥文件；只监听回环地址，不开放公网。两个窗口分别执行。

```powershell
# Window 1: start the unchanged pinned team Core.
node <team-checkout>/chenchen/server.js
# Window 2: serve this candidate with the allowlisted loopback proxy.
$env:CORE_URL='http://127.0.0.1:4175'
npm run preview
```

访问 `http://127.0.0.1:8917/workspace.html`。本机代理只开放既有 Core 演示组合、健康检查与任务/审计只读查询；不代理模型POST、Risk、审批、模拟执行或任何Finance资金写入。它是开发UI工具，不是正式生产BFF。

用途：复验本候选；CORE_SOURCE指定固定团队源码的chenchen目录，浏览器测试使用隔离的无登录Chrome。Playwright须在测试环境中可解析（可设置NODE_PATH）。

```powershell
npm run check
$env:CORE_SOURCE='<team-checkout>/chenchen'
npm test
npm run test:browser
node scripts/package.cjs
node scripts/security-check.cjs
```

正向演示：投资组合 → 填写期限/回撤/流动性 → Core健康检查 → 我的任务 → 安全与记录。到正式Risk即停止，展示待接入；不要声称AI、审批、执行均已完成。

千问演示：生活/组合选择范围 → 授权 → 若原候选服务已由Owner启动则允许用户自行请求；静态环境明确未连接。模型错误保持失败，测试替身不得用于对外验收。

转账演示：使用已知真实任务编号只读查询Core计划，分别展示Risk/审批/PAPER证据；无回执不显示模拟完成。真实资金始终关闭。

负向演示：自动测试使用明确合成案例验证拒绝、过期、版本篡改、401/403/409/423和UNKNOWN不重发。实际恶意输入/超额资金→统一可信Risk→Finance资金保护→审计的公网联合演示尚未验收，由Owner使用真实同任务链路补证。

## 集成与回退

只审查新team-staging目录和Contract缺口文档，不合并main、不复制到team-release。先运行候选，再由对应Owner评审正式集成；上线另需用户授权。回退时停止本机候选并保留原任务查询和证据，不删除记录、不重发UNKNOWN。精确个人来源SHA由团队SOURCE.json登记。
