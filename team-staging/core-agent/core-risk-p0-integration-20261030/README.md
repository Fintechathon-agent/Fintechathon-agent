# Core + Risk P0 集成候选

Owner：陈全宝（林粹）  
区域：`team-staging`，供团队修改、联调和审查。  
正式交付区：未更新；`team-release` 和 main 保持不变。

## 来源

- 个人候选仓库：[realchenchenluo/agent](https://github.com/realchenchenluo/agent/tree/codex/core-risk-p0-integration-20261030)
- 个人候选 SHA：`75dcfa269f63ef2fe81394277a0ce537b4feb9aa`
- Core 基线：`fe3a4ba`
- Risk PR #3：`e17c881`、安全修复 `c1cc3c4`、线上差异记录 `b15dbc2`
- 个人候选 PR：[待创建/审查](https://github.com/realchenchenluo/agent/pull/new/codex/core-risk-p0-integration-20261030)

## 目录说明

- `runtime/chenchen/`：Core Memory、任务状态、Risk Handoff、身份校验和测试快照。
- `runtime/modules/safety-risk-eval/interface-adapters/`：Risk 回写适配器、显式 PAPER 模拟回写器及测试。
- `runtime/chenchen/docs/`：本轮验证、配置名称和线上阻塞说明。

## 已验证

- Core：435 项，434 通过、1 跳过、0 失败。
- Risk 接口适配器：262 项通过。
- 联合预检：20 项通过。
- Golden Path：模型提议 → Risk → 人工审批 → PAPER 模拟 → 审计回放通过。
- 不调用真实模型、不产生真实资金操作；模拟回执 `side_effects=false`。

## 联调前必须确认

1. 冻结双方共同使用的唯一集成 SHA，并核对 Core/Risk Worker 部署 ID 与 Git SHA。
2. 双方服务端只确认 Secret 名称与配置状态：`CORE_AGENT_API_KEY`、`RISK_SERVICE_HMAC_SECRET`；不要把值发到群里或仓库。
3. Risk 只读回写和 `SIMULATION_ONLY` PAPER 回写分开，不能把 `REVIEW_ONLY` 升级。
4. 线上旧 PR27 健康页不能作为 v1.1 验收证据；重新部署后再做同任务 HTTP 联合验收。

当前状态：`LOCAL_CANDIDATE / ONLINE_NO-GO`。
