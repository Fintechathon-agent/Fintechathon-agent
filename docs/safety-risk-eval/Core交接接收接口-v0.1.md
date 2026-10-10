# Core → Risk 交接接收接口 v0.1

日期：2026-10-10。第四板块提案；已实现浏览器会话下的导入、检查、审计与执行隔离。不是已认证的跨服务直连，也不是大模型攻防完整验收。

## 交付范围

- 接收队友 `investment-agent.v1` 完整响应，支持新增的 `trace` / `audit_evidence`。
- 页面提供“接收 Core 交接包”，可粘贴原始响应、`{agent_response, risk_workbench}` 或本接口请求。
- 服务器生成本地 task/session，并使用当前会话身份；保存原始响应、原编号、摘要和映射关系。
- 校验完整结构、task/session/request/audit 关联、候选方案与模拟证据引用。校验通过不等于验证金融数据真实性或来源身份。
- 导入后运行现有 R01—R10，来源标为 `UNVERIFIED_EXTERNAL_RESPONSE`。策略固定阻止该任务获得执行权限，修改画像、用户确认和直接调用执行接口均不能覆盖。
- 不设置 CORS 通配、不允许客户端提交审批、用户身份或“已认证”标记，不向浏览器发放服务密钥。

## 与队友最新接口的关系

对齐基线：团队主分支 `4a1f4fe9737af12250ddcb6f0b9b51edaaf437a9`。

队友 `/api/risk-workbench/handoff` 返回 `agent_response` 与只读摘要 `risk_workbench`。本接口消费 **agent_response**。GitHub Pages 页面读取的固定 `risk-workbench-demo.json` 只有证据编号，不包含可校验的完整成果，不能导入。

兼容边界：`modules/safety-risk-eval/handoff/upstream.schema.json` 是上述提交的契约快照，独立校验新字段，未改队友文件。适配后给旧 Risk 的投影移除顶层 trace/audit_evidence 及 handoff.evidence.audit_id；原件完整保留。投影只重映射 task、session、handoff 的身份关联，金融成果不重算、不改变。

`example.response.json` 由上述主分支的 Core 实际运行固定请求生成，含真实程序输出和事件记录，但使用虚构数据、确定性 Core；加载示例不代表实时调用大模型。

## 页面操作

1. 打开 [风控工作台](https://fund-risk-workbench.panxintian44.chatgpt.site/risk)，展开“接收 Core 交接包”。
2. 从队友本地接口复制完整返回 JSON，或点击“载入已记录的 Core 示例”。只使用虚构资料。
3. 点击“校验并导入交接包”，查看原 task/request/session/audit 与新本地 task 的对应关系。
4. 展开权限策略与审计：可以看到 `HANDOFF_IMPORTED` 和 `POLICY_HANDOFF_UNVERIFIED`。确认和执行入口不可用。
5. 重复提交完全相同的包返回原任务；同一来源身份但内容改变，返回冲突，请 Core 生成新任务编号。

## HTTP 契约

部署地址与既有工作台相同。同源浏览器先 `GET /api/safety/session` 取得 CSRF，同时保留 HttpOnly 会话 Cookie。

```http
POST /api/safety/handoffs
Content-Type: application/json
X-Risk-Csrf: <当前会话返回值>
Cookie: <浏览器自动携带的当前会话>
```

```json
{
  "import_version": "risk-handoff.import.v1",
  "agent_response": "此处放完整 investment-agent.v1 响应对象，而非字符串或只读摘要"
}
```

上方 JSON 用来解释形状，字符串占位不能提交。可提交的完整示例由 `GET /api/safety/handoffs/example` 提供。请求最大 65536 字节，每个会话最多20个任务；已有会话的存储容量和审计上限仍适用。

成功返回：import_version、task_id、source、source_digest、provenance、replay、execution_allowed=false、risk、policy、workbench_path。HTTP 200 表示包接收成功，**不是 ALLOW 或执行授权**。

| 接口 | 用途 |
| --- | --- |
| GET /api/safety/task?task_id=… | 本地任务、Risk、Policy 与 handoff_import.original_response |
| GET /api/safety/audit?task_id=… | 本工作台产生的接收、检查、拦截事件 |
| GET /api/audit/{task_id} | 原 Core 审计证据（标识未认证）与本工作台安全事件 |

任务和审计都要求同一浏览器会话。另一个浏览器不能靠知道 task_id 读取。返回工作台链接也不会自动转移会话；不能把链接当成访问凭据。

### 固定失败原因

| 原因 | 状态 | 恢复 |
| --- | --- | --- |
| HANDOFF_ENVELOPE_INVALID | 400 / ERROR | 仅提交版本与完整响应；移除客户端权限字段 |
| HANDOFF_SCHEMA_INVALID | 422 / ERROR | 按冻结契约补齐完整响应 |
| HANDOFF_NOT_READY | 422 / ERROR | Core 完成至待 Risk 阶段后再提交 |
| HANDOFF_TRACE_MISMATCH | 422 / ERROR | 修复请求、任务、会话、审计编号关联 |
| HANDOFF_EVIDENCE_INVALID | 422 / ERROR | 补齐持仓、候选方案、测算与对应引用 |
| HANDOFF_IMPORT_CONFLICT | 409 / ERROR | 来源编号已被不同内容使用，生成新来源任务 |
| POLICY_HANDOFF_UNVERIFIED | Policy BLOCK | 后续接通服务身份验证；普通确认不可覆盖 |
| CSRF_REQUIRED / ORIGIN_MISMATCH | 403 / BLOCK | 在工作台自己的会话内导入 |

## 审计与来源界限

原件摘要使用规范化 JSON 的 SHA-256；用于关联与检测内容变化，不是数字签名。来源服务、模型调用真实性、原始审计不可篡改性均不由此摘要证明。

`HANDOFF_IMPORTED` 包含原 source、source_digest、本地 task/session、来源级别和 execution_allowed=false。重复导入记录 HANDOFF_IMPORT_REPLAY。格式拒绝记录最小 HANDOFF_IMPORT_REJECTED，不保存无效请求正文；这类没有任务的拒绝事件暂不在任务页展示。执行拦截记录仍归入本地任务。

## 给队友的下一步接入约定

目前可通过工作台内导入完成真实接收与评审。队友网页跨域直接 fetch 仍被拒绝；不要通过开放跨域或把来源改成 USER 来绕过。下一阶段由第一、二板块确定可信服务身份、会话归属和签名/令牌机制，第四板块校验发送者、受众、时效、nonce、完整内容摘要和防重放，再决定是否允许已验证来源进入审批。

真正的攻防演示继续需要：模型调用标识与真实输入/输出 → 结构化拟议动作 → 同一动作送 Risk/网关 → 实际工具调用数 → 关联审计。若模型已经拒绝，展示 Agent 层阻断；不能把人工构造探针伪称为模型输出。本轮没有完成这两段。

策略升级为 `financial-policy-v2`，旧的未执行确认需重检、重确认；已完成的幂等回执仍有效。
