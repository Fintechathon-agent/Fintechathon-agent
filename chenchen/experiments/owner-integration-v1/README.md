# Core ↔ Risk 实际源码本地联调 v1

日期：2026-10-18。范围：Core 主链路、可复现集成验证；不修改 Risk 规则、Memory 规则和 UI。

这不是又一套风控实现。验证器把当前 Core 的部署入口与团队 Risk 已有代码在本地接起来；仅模型供应商使用明确标注的测试替身。不会调用外部模型、账户或交易服务。

## 运行方法

需要 Node.js 22+、Git、tar、npm，并能读取团队仓库。先获取已固定的 Risk 版本；不切换、合并或修改团队分支。

```powershell
git -C <团队仓库路径> fetch origin codex/long-text-workbench-integration-20261018
# 以下在 chenchen 目录运行
$prepared = node experiments/owner-integration-v1/prepare-owner.js --team-repo <团队仓库路径> | ConvertFrom-Json
node experiments/owner-integration-v1/verify.mjs --snapshot $prepared.directory --output <新的证据文件.json>
node experiments/owner-integration-v1/check-contract.mjs --snapshot $prepared.directory --evidence <新的证据文件.json>
```

准备脚本从提交 `ba5056621224f969eca75ce946403f8f70e95d23` 导出只读源码快照到系统临时目录，并在快照中执行锁文件安装（禁用安装脚本）。验证器在导入前逐文件核验 178 个 Git blob；Windows 启动文件按该提交已有属性归一化换行，且不执行这些启动器。输出路径请使用新文件名，以保留历史证据。

`verify.mjs` 返回 0 表示本地列出的断言全部符合预期；包括“应当拒绝”的场景。状态是 `LOCAL_CHECKS_PASSED_INTEGRATION_PENDING`，不是正式接通。当前 `check-contract.mjs` 返回 1：实际导出字段 `source_task_id` 不在严格 Handoff Schema 中。这是真实失败，不是预期失败转成功，也没有删字段或放宽 Schema。

## 实际连接了什么

- Risk 的长句拆分、逐项确认、资金冲突规则、审批、沙盒执行、占用账本和文件审计，直接来自固定的团队源码。
- Risk 模型消费者发起的请求，通过本机 HTTP 调用当前 Core Worker 的真实请求处理器；响应仍由 Risk 原验证器检查。
- 仅供应商推理结果为合成数据。请求/响应内的 `call_succeeded` 以及 Risk 原代码中的 LIVE/“真实模型”字样，描述其内部通路，不构成本次真实模型调用证据。以最外层 `real_model_called:false` 和每条 `SYNTHETIC_TEST_DOUBLE` 为准。
- Risk 使用临时磁盘日志；Core 使用内存存储适配器验证重新创建服务后的记录恢复，不等于 Cloudflare 跨实例或真实存储故障验收。
- Core 与 Risk 通过来源任务编号关联，但仍是两个任务记录；正式签名回调尚未配置，Core 保持等待风控。

结果、限制、待确认事项见 [本轮说明](../../docs/core-agent-integration-iteration-2026-10-18.md)。不要把此试验发布为正式风控服务，也不要修改源码快照来让测试通过。
