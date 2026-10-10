# 2026-10-09 市场简报回放测试记录

## 测试目的

使用用户提供的《每日市场简报_2026-10-09.pdf》作为固定参考夹具，验证 Core Agent 能否接收带有来源、数据日期和观点冲突的金融信息，并在不改变 Quant、Memory 和 Risk 边界的情况下完成主链路回放。

原始 PDF 不上传 GitHub；只上传整理后的最小测试数据和测试结果。

## 测试数据

数据文件：data/market-brief-2026-10-09.json

| 样本 | 数值 | 数据时间 | 用途 |
| --- | ---: | --- | --- |
| 沪深300 | 4317.25，+0.16% | 2026-10-09 15:00 | A 股背景 |
| 创业板指 | 3043.34，+0.22% | 2026-10-09 15:00 | 与海外 AI 硬件方向对照 |
| 纳斯达克 | 27193.34，-1.25% | 2026-10-09 04:47 | 跨市场背景 |
| COMEX 黄金 | 4213.86，+1.37% | 2026-10-09 18:00 | 贵金属反弹样本 |
| COMEX 白银 | 60.71，+2.16% | 2026-10-09 18:00 | 贵金属弹性样本 |
| NYMEX 原油 | 90.42，-1.17% | 2026-10-09 18:00 | 商品回落样本 |
| 美债10Y | 5.22%，前值5.28% | 2026-10-08 18:00 | 官方数据与观点冲突 |
| 美债30Y | 5.60%，前值5.67% | 2026-10-08 18:00 | 官方数据与观点冲突 |

简报同时记录了“10年期美债收益率可能上破6%”的机构前瞻观点。测试将它标记为观点，不把它覆盖成事实；官方收益率数据单独标记为 OFFICIAL_SOURCE。

## 回放路径

~~~text
2026-10-09 固定夹具
  -> market-brief.context 校验来源、字段、重复资产和异常
  -> Core Agent 写入 market_context Artifact / ToolResult
  -> 生成统一 trace 和 audit_evidence
  -> Risk Handoff 引用市场上下文和 audit_id
  -> execution_allowed=false，停止在 Risk 边界
~~~

## 自动化结果

### 市场上下文校验：通过

- 14 条市场观察全部通过字段、正数和唯一 asset_id 校验。
- 异常波动阈值为绝对涨跌幅不低于 3%；本日没有触发自动异常波动项。
- 10Y / 30Y 官方数据来源状态为 OFFICIAL_SOURCE。
- “观点提示收益率可能上破6%”与官方数据回落被记录为 rates-view-data-conflict，状态为 REVIEW_REQUIRED。
- AI 硬件跨市场方向和基金规则修订被记录为 OBSERVED，只作为研究上下文。

### 主链路回放：通过

- 版本化请求正常进入 investment-agent.v1。
- response.trace 能关联 request_id、task_id、session_id。
- audit_evidence 记录 session.created、阶段完成和 contract.accepted 等事件。
- Risk Handoff 引用了 audit_id 和 market_context_id。
- execution_allowed 保持 false。

### Quant 不漂移：通过

同一份演示持仓分别运行“无市场上下文”和“带 2026-10-09 市场上下文”两次：

- 健康报告 metrics 一致。
- 候选方案 target_weights 一致。
- 模拟 comparisons 一致。
- 新增内容仅为 market_context、ToolResult、trace、audit_evidence 和 Risk 证据引用。

### 错误和恢复 Contract：通过

错误响应固定包含 code、message、retryable、stage、recovery。阶段重试和任务失败事件会进入 audit_evidence，便于 Backend、Agent、Risk 和 UI 使用同一套字段联调。

## 来源与限制

- 沪深300、上证指数、创业板指、恒生指数、商品和汇率：按简报标注的新浪 / 东财 push2 交叉校验状态记录。
- 美债10Y、30Y：按简报列出的美国财政部官方数据口径记录；FRED 可能存在日期滞后，不能混用日期。
- 政策、央行、机构观点和三季报披露统计：按简报内容作为 REFERENCE_ONLY；它们不是 Core Agent 的实时数据接口。
- 这是固定回放，不是实时行情，不构成投资建议；市场信息不会直接变成买卖动作。

## 结论

本轮数据已能在 Core Agent 主链路中完成可复现回放。当前剩余的集成阻塞是独立 Risk Consumer 尚未接入，以及真实数据源和新闻证据还没有经过 Research、Risk、Quant 共同冻结版本化字段；在这两项完成前，继续保持固定夹具和人工复核边界。
