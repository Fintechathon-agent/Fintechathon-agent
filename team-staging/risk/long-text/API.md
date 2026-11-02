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

## 错误

结构为 `{ "error": { "code": "...", "message": "..." } }`。常见状态：400 无效 JSON，403 非本机同源，404 草稿不存在/隔离/过期，409 旧版本或模型复核进行中，413 请求过大，422 输入/核对问题，429 草稿容量已满，502 模型失败，503 模型关闭。

模型请求失败时不生成伪造成功结果，供应商错误内容不回显。并发改动会使旧模型响应返回 409，不能粘到新草稿。重复确认同一版本返回已有结果；每次实际修改增加版本并撤销确认。会话和审计是进程内临时数据，不是正式服务的身份或审计存储。
