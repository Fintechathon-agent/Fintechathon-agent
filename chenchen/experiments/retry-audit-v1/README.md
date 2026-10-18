# 旧入口重试保护与任务记录导出

本轮沿用现有 Core 接口和冻结字段，修复旧入口丢失幂等键的问题，增加不联网的任务记录导出工具。模型、风控和审批在本目录试验中均为明确标注的本地替身；不代表正式 Risk Owner 已完成接入。

## 旧入口怎样接

`POST /api/review/legacy` 仍接受 `{ "question": "…" }`。同一次用户操作在开始时生成一个稳定的 `Idempotency-Key` 请求头，失败重试时保留原键和原正文；正文已有 `idempotency_key` 时沿用现有“正文优先”的规则。不要每次重发生成新键。

```json
{
  "question": "虚构案例：预留房租后是否还可以追加投资？",
  "idempotency_key": "synthetic-user-operation-001",
  "action_parameters": { "amount": 4000, "currency": "CNY", "synthetic": true }
}
```

现在旧适配器会将幂等键传入已有统一工作流。相同键与正文返回同一任务；换金额、问题或原会话内容返回 409。保存状态不确定时返回 503 / retryable=false，须查原任务，不换键自动重试。超长问题由既有统一校验器返回 422，不再静默截断。无键请求仍保留原行为，不能凭文本相似自动认定为同一笔操作。

历史请求曾经丢失的键无法补造。上线前已发出的无键旧任务，应按原 task_id 查询，不要期待新版本能找回未保存的幂等关系。会话映射、Memory 同意规则、公共 Schema 和模型配置本轮不改。

## 用记事本查看完整过程

先使用既有 `GET /api/review/task/{task_id}` 获得**完整工作流 JSON**并保存到本地。旧入口响应摘要和 risk-handoff 包不包含完整字段，不能替代这个文件。

在 chenchen 目录运行：

```powershell
node scripts/export-review-evidence.js --input <完整任务.json> --output-dir <尚不存在的输出目录>
```

输出 `任务记录.txt` 和 `manifest.json`。TXT 可直接用记事本打开；包含任务/运行/审计编号、阶段状态、事件列表和发现的问题。manifest 保存原文件及 TXT 的 SHA-256，可检查拿到的文件是否与导出时一致。已有输出目录不会覆盖，父目录须已存在。

默认省略输入正文、模型回答、金额细节和自由文本理由，**并非完整匿名化**：任务编号、模型回执编号和事件仍来自输入，分享前需核对。确需包含原文时，显式加 `--include-content`；它会附输入、模型响应、风控、审批、模拟回执及全部审计事件，应只在获授权范围内保存和分享。工具无网络能力，不自动上传任何文件。

退出码：0 为所检查项目内部一致（仍有真实性限制），2 为发现不一致且已输出可查看报告，1 为输入/参数/文件错误。旧记录缺少追踪字段可能被标为证据不完整，不会替它补造字段。工具不验服务器签名，不认证文件来源，不修改任务，不赋予执行权限，也不替代正式 Schema 校验或联合验收。

## 复跑本地链路

```powershell
node --test tests/legacy-retry.test.mjs tests/review-evidence.test.js
node experiments/retry-audit-v1/verify.mjs --output-dir <尚不存在的证据目录>
```

验证器调用当前 Worker 的真实请求处理器，使用本地存储适配器；供应商、Risk 决策和人工确认由测试代码提供。Risk 与审批各用一次性随机签名密钥，密钥及签名正文头不导出。检查无签名/签名后篡改被拒、同一回调重放、未批准阻断、参数变更阻断、模拟回执重载复用、拒绝、未配置正式网关、批准过期、模型失败。

未配置 Risk 地址时仍返回 503；本试验直接送入签名回调验证 Core 边界，不是把真实 Risk 服务接到了公网。生成文件包含明确的 synthetic 标识，`joint_acceptance=false`。401 请求发生在工作流变更前，其请求/响应在 verification.json 中，不假装它已有同任务业务审计事件。

本轮 [证据目录](../../docs/core-agent-retry-audit-evidence-2026-10-19/) 和 [完整交付说明](../../docs/core-agent-retry-audit-2026-10-19.md)。
