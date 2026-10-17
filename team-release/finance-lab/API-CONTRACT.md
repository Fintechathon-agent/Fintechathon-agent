# Finance Lab · 统一接口契约（正式交付共用）

## 模型请求

`POST /api/review`

```json
{"question":"请检查我的持仓健康状况"}
```

响应必须保留 `run_id`、`decision_source`、`model_status`、`execution_state`、`recommendation`、`gate`、`whatif` 和审计关联字段。`demo` 模式在模型不可用时明确返回 `decision_source: "rules"`；`live` 模式在 Key 缺失或调用失败时返回 `status: "error"`、`code: "MODEL_UNAVAILABLE"`，不能伪装成模型成功。

## 六场景请求

- `POST /api/scenarios/run`：自然语言输入，返回场景、意图槽位、任务 DAG、权限等级和结果/待确认项。
- `POST /api/scenarios/confirm`：确认黄色/红色待办，服务端重新核验余额、日累计、卡状态、审批状态和强验证信息。
- `POST /api/scenarios/cancel`：取消待办或预约。
- `GET /api/scenarios/pending`：读取待确认队列。
- `GET /api/audit`：读取审计时间线。
- `POST /api/breaker/reset`：人工确认原因后恢复熔断。

所有金额单位为元，时间使用 ISO 字符串；演示记录带 `source: "demo"` 和 `as_of`，不能表述为实时银行数据。模型只提出建议，确定性代码执行意图解析、金额/限额校验、风控闸门和回执状态。

## UI 对齐

UI 以 JSON 契约消费结构化结果：意图、DAG 节点、权限、证据、审批/执行状态、审计和情景推演分别渲染；待确认不显示为已执行。PDF、PPT、Word、Excel、图形导出格式尚未实现，后续统一使用这些字段作为渲染输入，不在各模块另起接口。

## 模型配置

默认 `base_url=https://api.deepseek.com`、`model=deepseek-chat`，也可替换为兼容 OpenAI Chat Completions 形式的服务。只使用启动环境中的 `DEEPSEEK_API_KEY`；禁止把 Key、Plus 账号或本机凭据提交到仓库。