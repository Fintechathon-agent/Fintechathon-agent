# 在线演示部署适配

只用于虚构资料与团队评审。继续使用第四板块的规则程序、网关和第三板块的固定演示工具；没有接真实交易、正式账号或大模型服务。

新增可配置的服务端真实模型入口，当前尚未配置生产模型服务。配置、限额、审计与队友后端依赖见 [真实模型攻防接入](../../../docs/safety-risk-eval/真实模型攻防接入-v0.1.md)。公开页面缺少模型配置时默认关闭该入口；不使用 Codex 登录凭据。数据库新增 `0001_model_budget` 迁移，更新时保留旧会话与审计。

## 文件与运行

2026-10-11 已接通队友远程 Core：`GET /api/safety/core-status`、`POST /api/safety/core-handoff`、`GET /api/safety/core-requests`。服务端固定 HTTPS 地址，保留只读权限，不代替真实模型接入。接口和审计说明见 [远程 Core 联调](../../../docs/safety-risk-eval/远程Core联调-v0.1.md)。`check-remote-core.cjs` 通过 `RISK_BASE_URL` 指定站点、`RISK_REMOTE_REPORT` 指定报告路径，调用真实后端验证。

- `worker.mjs`：HTTPS 接口、会话归属和浏览器确认校验，提供原投资组合页面与风控页面。
- 部署内的投资组合导航返回 `/risk`；未部署的店主入口不出现在本演示中。旧 `/merchant` 地址返回 `/investment`，不修改队友的原页面。
- `cloud-store.mjs`：D1 持久化、会话租约、审计链及中断执行恢复。
- `build.mjs`：嵌入固定数据与页面，预编译 JSON Schema 校验器，避免在 Worker 中读取本机文件或动态生成校验函数。
- `drizzle/`：工具生成的迁移、快照和日志；发布后不得修改已应用的迁移。
- `preview.mjs`、`test/sqlite-d1.mjs`：仅用于本地验证，以 SQLite 执行同一迁移和 SQL，不能代替真实 D1 验证。

Node 24；先安装 `docs/safety-risk-eval/contracts/` 与本目录的锁文件依赖。

```powershell
npm ci --prefix docs/safety-risk-eval/contracts
npm ci --prefix modules/safety-risk-eval/hosting
node --test modules/safety-risk-eval/test/*.test.cjs modules/safety-risk-eval/hosting/test/*.test.mjs
node modules/safety-risk-eval/hosting/build.mjs
node modules/safety-risk-eval/hosting/preview.mjs
```

构建前，部署目录 `output/sites/risk-workbench/.openai/hosting.json` 必须已有选定站点的标识，`d1` 为 `DB`。默认不会新建站点；重新部署保留标识。`output/` 不上传团队仓库。

## 云端写入边界

1. 安全 cookie 标识演示浏览器会话，服务端生成用户和确认令牌；不接受客户端自报权限或审批结果。
2. 每次变更先获得同一会话的 120 秒租约，并检查同源、确认令牌、允许字段。
3. 网关在调用模拟工具前先写入执行标识与启动审计，再等待 D1 持久化成功。失败时零工具调用。
4. 执行结果及 Memory 写入后再次持久化，完成后才返回成功。
5. 请求中断留下的 `RUNNING` 恢复为 `UNKNOWN`，重复请求返回已有状态，不能自动重试。演示未公开人工核查接口。

同一浏览器最多 20 个任务、800 条审计、约 1.8 MB 状态。超过限制暂停；确认有效期沿用网关演示配置 15 分钟。浏览器清除 cookie 后创建新会话，旧记录不能通过网址跨会话读取。演示会话不等同于团队账号认证。

## 发布与验证

使用 Sites 技能的源仓库同步与部署流程：公开访问已有用户授权。源码提交、远程编号和构建包必须一致；凭证只从标准输入传入，不写文件、不放命令参数。

`package-portable.cjs` 仅用于 Windows 官方打包命令因缺少 Bash 失败后的备用打包，先验证官方流程已推送的源码，再调用相同的构建输出整理脚本与 Windows `tar`。

发布后运行 `../scripts/browser-check.cjs` 与 `check-access.cjs`，通过 `RISK_BASE_URL`、`RISK_BROWSER_ARTIFACTS`、`CHROME_PATH` 指定公网地址、证据目录和浏览器。这些是模拟流程与访问边界验证，不构成真实金融系统验收。

D1 接口与 Worker Node 兼容要求参考 [D1 官方说明](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) 和 [Worker Crypto 兼容说明](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)；预编译校验参考 [Ajv 独立代码说明](https://ajv.js.org/standalone.html)。
