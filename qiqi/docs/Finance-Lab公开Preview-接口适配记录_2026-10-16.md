# Finance Lab 公开 Preview 接口适配记录

日期：2026-10-16

## 已完成

本仓库新增了公开 Preview 所需的只读兼容层，保留现有 `/api/review`、审批和六场景接口不变：

| Preview 路径 | 本地实现 | 边界 |
|---|---|---|
| `GET /api/demo/portfolio` | 返回当前演示组合的 `investment-agent.v1` 快照 | `SYNTHETIC_REPLAY`，不是真实账户 |
| `POST /api/health-check/run` | 读取组合与偏好，生成确定性诊断、A/B/C/CURRENT 只读比较 | 固定停在 `HANDOFF_REQUIRED`，`execution_allowed=false` |
| `GET /api/task/{task_id}` | 进程内任务只读回看 | 服务重启后不保证保留 |
| `GET /api/audit/{task_id}` | 返回当前任务关联的审计事件 | 只读，不等于生产持久化 |
| `GET /api/task/{task_id}/export` | 返回同一任务 JSON | 不生成交易回执 |

健康检查使用固定种子、20 日窗口和 2,000 条重采样路径，结果带有 `SYNTHETIC_REPLAY`、数据源和交接状态。适配层不会调用 `/api/decide`，不会新增审批，也不会修改 PAPER 账本。跨 Origin 联调可通过 `--cors-origin` 或 `FINANCE_LAB_CORS_ORIGIN` 精确放行一个来源。

## 数据核对结论

仓库中的真实历史夹具仍与 Preview 的演示数据分开：

- 2026-09-16 至 2026-10-13 的 14 个交易日，`600519`、`000001`、`510300`、`600036` 的历史收盘价与 Eastmoney 逐日比对为 0 个差异；基金 `000001` 净值同窗口也为 0 个差异。
- 10 月 14–15 日简报原始数据缺失，已在 `brief/out/runner_log.md` 留痕，没有补造数值。
- `config.fund.yaml` 的默认行情源仍是 `mock`；本次 Preview 适配明确使用合成回放，不能把它写成实时行情或一个月实盘验收。

## 仍需外部接入

GitHub Pages 上的静态 Preview 当前仍按相对路径请求 API，因此公网环境继续得到 404；本地适配层完成后，还需要一个可访问的 HTTPS 后端地址，并在 Preview 的 `site-context.mjs` 配置该地址、部署后再做公网联调。当前没有把本地 `127.0.0.1` 或私有 `market.db` 暴露到公开仓库。

## 验证

- `python -m unittest tests.test_preview_contract -v`：3/3 通过。
- 本地端到端请求：组合读取 200、健康检查 `HANDOFF_REQUIRED`、任务回放 200、审计回放 200。
- `python -m py_compile web/app.py web/launch.py web/preview_contract.py`：通过。
