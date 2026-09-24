# Portfolio Sentinel

Portfolio Sentinel is a Personal AI Investment Manager prototype for one narrow, reproducible Golden Path: `Portfolio Health Check -> Strategy Comparison -> Backtest/Scenario -> handoff to Risk/Approval`.

产品愿景仍然是“让每个人都拥有自己的 AI 投资经理”。本轮实现严格限定在两个责任域：

- Agent Core & Memory：Session、TaskState、固定 DAG、checkpoint、单次重试、失败恢复、circuit breaker、session-only memory。
- Tools & Financial Data：固定 A 股/场内 ETF/现金 Demo 数据、Portfolio 校验、确定性诊断、A/B/C 候选、固定 seed 情景模拟、Paper Trading mock。

本版本不连接真实银行或券商账户，不执行真实资金交易，不实现 Safety/Risk/Eval 或前端职责内的新增功能。Paper Trading 工具只接受上游 Safety 生成的结构化 approval contract，缺少审批时 fail closed。

## Run

```powershell
npm install
npm run check
npm test
npm start
```

Open <http://127.0.0.1:4173> for the existing demo UI.

## API smoke path

All financial results contain a tool version, input hash, data-as-of date, warnings, and trace id.

```powershell
$risk = '{"investment_horizon_days":365,"max_drawdown":0.1,"liquidity_need":"medium"}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4173/api/session/init -ContentType 'application/json' -Body ("{""risk_profile"":$risk}")
```

The main orchestration endpoint is `POST /api/health-check/run`. It returns the task state, checkpoints, portfolio snapshot, health report, three candidates, and fixed-seed simulation, then stops at `RISK_CHECK` with an explicit handoff to the Safety/Risk/Eval owner.

Other endpoints:

- `GET /api/demo/portfolio`
- `POST /api/portfolio/import`
- `POST /api/portfolio/diagnose`
- `POST /api/strategy/generate`
- `POST /api/simulation/run`
- `POST /api/paper-trade/execute`
- `GET /api/audit/{task_id}`
- `POST /api/memory/save`, `GET /api/memory?session_id=...`, `POST /api/memory/clear`
- `POST /api/demo/reset`

## Reproducibility and boundaries

- Demo dataset: `data/demo-portfolio.json`, fixed as-of date `2026-09-23`.
- Scenario engine: 2,000-path block bootstrap, seed `20260924`, identical data window and transaction cost for Current/A/B/C.
- Raw portfolio data remains session-only unless a user explicitly consents to saving a preference or decision memory.
- Paper trade is in-memory mock state and is idempotent by `idempotency_key`.
