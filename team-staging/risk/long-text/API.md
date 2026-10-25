# long-text-risk.v1 本地接口

基础路径 `/api/long-text/v1`。POST 使用 UTF-8 `application/json`，最大 128 KiB；保留服务端发放的 `long_text_session` Cookie。来源限本机同源页面。金额为人民币整数分，未知值为 `null`，不使用字符串或 NaN；每字段金额上限 100,000,000 元。

| 方法与路径 | 请求 | 返回 |
| --- | --- | --- |
| GET `/health` | 无 | 模块、策略版本与模型开关 |
| POST `/intake` | 原文、分析日、模式和区间 | 新草稿、事项、资金事实、待补问题 |
| POST `/revise` | 版本绑定 + 新原文、分析日、区间 | 重新解析，撤销之前确认和结果 |
| POST `/correct` | 版本绑定 + `items` + 可选 `profile` | 原子更新，返回最新版本 |
| POST `/confirm` | 版本绑定 + 全量核对 ID + 确认标记 | 确定性风险结果 |
| POST `/export` | 版本绑定 | 完整草稿、确认、结果和审计 |
| POST `/review-draft` | 版本绑定 | 尚未提交的 `model-review.v1` 请求 |
| POST `/model-review` | 版本绑定 | 可选在线模型复核，保留确定性结果 |

## 创建草稿

```json
{
  "text": "我目前现金5万元，保底1万元。下个月5号交房租3500元，下个月20号交学费2万元。我想投资2万元。",
  "as_of": "2026-10-18",
  "data_mode": "SYNTHETIC_REPLAY",
  "horizon_days": 90
}
```

`channel` 可为 `speech_transcript`，必须同时提供 `is_final: true`。中间语音转写不进入测算；此接口接收文本，不提供语音识别服务。

响应的 `draft_id`、`revision` 和 `interpretation_sha256` 构成版本绑定，后续每次请求必须使用最新返回的三项。草稿中 `source_span.start/end` 是 UTF-16 下标，`end` 不包含尾字符，可用 JS `source_text.slice(start,end)` 校验。不要用 UTF-8 字节偏移解释。

草稿输出新增只读 `planning_preview`，在解析、纠错、恢复和导出时根据当前事项重新计算。`scope=UNCONFIRMED_PARTIAL_BUDGET`；`expense_rows` 列出已知金额区间或缺失预算，`known_expense_range_minor` 为已知支出上下限，`remaining_after_known_expenses_minor` 仅为现金扣除这些支出后的区间，未扣除其他资金事实与投资。`next_steps` 指出需要补充的预算及口径，`suggested_horizon_days` 可提示年度计划。它不授予风险审批，不绕过 `confirm` / `handoff`。

事项的 `amount_range_minor={min,max}` 保留人民币整数分的上下限，同时 `amount_minor=null`，需通过 `correct` 选择实际测算金额。`context_kind` 标记标题、提问、顾虑、地点与旅行补充信息；默认 `EXCLUDE` 并保留原因、原文及核对要求。`expense_category` 是支出标签；`amount_basis=REMAINING` / `allocation_intent=ALL_IN` 只是投资意图，不会自行产生投资金额。这些解释字段不可通过纠错接口直接篡改。

## 纠错与确认

`correct.items` 每项包含 `id`，可修改 `type`、`amount_minor`、`due_date`、`recurrence`、`certainty`、`disposition`、`exclusion_reason`。不可修改原文范围、风险结果、确认记录或权限。`profile` 可修改 `cash_minor`、`hard_floor_minor`、`existing_holds_minor`、`fees_minor`，四项都须明确。

类型：`CASH / RESERVE / EXPENSE / INCOME / INVESTMENT / ASSET / OTHER`。处理方式：`INCLUDE / EXCLUDE / UNRESOLVED`。周期：`ONCE / DAILY / WEEKLY / MONTHLY`。确定性：`EXPECTED / UNCERTAIN`。排除事项需说明原因，仍须逐项核对。带 `requires_split` 的混合句不能仅通过改金额绕过，须修改原文或明确排除。

```json
{
  "draft_id": "使用响应的draft_id",
  "revision": 2,
  "interpretation_sha256": "使用最新响应的哈希",
  "reviewed_item_ids": ["item-0", "item-1", "item-2", "item-3", "item-4"],
  "confirmed": true,
  "nonoverlap_confirmed": true
}
```

示例中已有占用和费用确认均为 0 后，`decision=BLOCK`，`expense_total_minor=2350000`、`available_for_new_action_minor=1650000`、`projected_free_after_minor=-350000`、`shortfall_minor=350000`。将投资改为 1 万元并重确认后，`decision=ALLOW`、`projected_free_after_minor=650000`。

`result.review` 保留原 Risk 输出；`result.metrics.cashflow` 是已核对收支的情景时间线。金额冲突等级不是投资产品风险等级。`account_verified / risk_approval_granted / execution_allowed / memory_write_performed` 始终为 false。

## 集成工作台的草稿资金建议

`POST /api/safety/long-text/plan-review` 仅在集成工作台提供，沿用 `risk_session` 与 `X-Risk-Csrf`。请求只接收 `{draft_id, revision, interpretation_sha256}`，不接收客户端模型提示、账户身份或审批字段。可以在付款日期和投资额度未确定时调用，无需提前确认整份草稿。

服务端以当前纠错版本生成模型材料：对外金额明确为人民币**元**，保留预算区间、逐项支出、保守余款及未知扣项；未知值不当作零。返回 `proposal`、从模型原文分段的 `sections`、运行与摘要凭据、参考来源和 `quality`。调用不会创建工作台任务、授予审批或执行投资。

检查现金、支出上限、余款等金额锚点、具体安排与风险内容、压力情景和追问；泛化回答最多自动重试一次，不符合检查的回答不展示为有效建议。格式识别兼容标题和自然段，不改写模型原文。该检查不等于对模型全部陈述的事实担保。

每草稿累计最多6次实际调用（自动重试也计数），与其他模型入口共享每天30次上限。结果保存在 `planning_review`；实际修改原文或事实后清除，调用期间改动或过期则丢弃旧回答。失败不生成离线替代答案，仍可查看确定性预算概览。

## 错误

结构为 `{ "error": { "code": "...", "message": "..." } }`。常见状态：400 无效 JSON，403 非本机同源，404 草稿不存在/隔离/过期，409 旧版本或模型复核进行中，413 请求过大，422 输入/核对问题，429 草稿容量已满，502 模型失败，503 模型关闭。

模型请求失败时不生成伪造成功结果，供应商错误内容不回显。并发改动会使旧模型响应返回 409，不能粘到新草稿。重复确认同一版本返回已有结果；每次实际修改增加版本并撤销确认。会话和审计是进程内临时数据，不是正式服务的身份或审计存储。
