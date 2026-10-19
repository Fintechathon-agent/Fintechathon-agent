# Core Agent Golden Path v1

这是一条本地合成数据验收脚本，用来复跑完整主链路：

`模型提议 → Risk Handoff → Risk 决定 → 人工审批 → PAPER 模拟执行 → 审计回放`

脚本会同时验证一条正常路径和一条被 Risk 拒绝的路径。正常路径必须经过 `PENDING_RISK`、`PENDING_APPROVAL`、`READY_FOR_SIMULATION` 后才会生成没有副作用的模拟回执；拒绝路径进入 `REJECTED` 后，模拟执行仍返回阻断错误。

## 运行

在仓库根目录执行：

```powershell
node chenchen/experiments/golden-path-v1/run.mjs
```

脚本只使用内存存储和合成 Workers AI 响应，不访问互联网、不调用真实模型、不调用正式 Risk、不使用审批身份、不连接执行网关，也不会产生付款、交易或账户变更。

## 输出

- `chenchen/docs/core-agent-golden-path-tests-2026-10-19.json`：可核查的状态、任务关联、审计事件和限制。
- `chenchen/logs/core-agent-golden-path-2026-10-19.jsonl`：逐步运行日志，每行包含接口、HTTP 状态、任务追踪编号、执行开关和当时已写入的审计事件。

这份证据属于临时共创区。`status=PASS` 只表示 Core 的本地合成链路通过，不代表真实模型、正式 Risk、可信审批或执行网关已联合验收。

