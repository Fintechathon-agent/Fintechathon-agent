# Finance Lab · 暂存同步入口

这里登记七七个人源目录的 Finance Lab 银行 AI 安全任务台，供团队联调。源代码统一维护在 [`qiqi/`](../../qiqi/)，本目录不复制第二套后端。

- 来源提交：`90dcec4`（接入团队统一后端 Core Agent）；上一登记来源 `1401d84`（报告产物导出契约）、`1d97ac2`（个人仓 `jinyihan77-create/personal-ai-fund-manager` 的 `master`）
- 当前状态：222 项 Python 回归通过（含 10 项统一后端适配测试、15 项随手记、26 项 MCP），固定安全样本 54/54 拦截、0/20 正常误伤；等待团队联合验收。
- 统一后端联调（2026-10-20）：`GET /health`、`GET /api/review/capabilities` 200；一次真实模型 `POST /api/review` 返回 `PENDING_RISK`，`execution_allowed=false`、审批 `BLOCKED`。本侧新增 `web/core_agent.py` 与两条路由，失败不回退。见 [`qiqi/docs/统一后端联调记录_2026-10-20.md`](../../qiqi/docs/统一后端联调记录_2026-10-20.md)。
- 运行与边界：[DELIVERY.md](DELIVERY.md)
- 请求/响应契约：[API-CONTRACT.md](API-CONTRACT.md)
- 报告产物导出契约（渲染器待实现）：[`qiqi/docs/导出契约_2026-10-17.md`](../../qiqi/docs/导出契约_2026-10-17.md)

暂存区可以继续修改和联调；通过团队确认后，再按同一来源提交登记到 `team-release/finance-lab/`。

- 蒸馏方案（草案）：[REVERSE-ENGINEERING-DISTILLATION.md](REVERSE-ENGINEERING-DISTILLATION.md)
- MCP 能力中心（10-17）：12 项能力、7 只读 / 4 待确认 / 1 联动，无 `confirm` 工具；方案见 [`qiqi/docs/MCP能力中心_逆向蒸馏与接入方案_2026-10-17.md`](../../qiqi/docs/MCP能力中心_逆向蒸馏与接入方案_2026-10-17.md)
- 随手记（10-17）：生活与投资统一入口，规则识别试用版；说明见 [`qiqi/docs/随手记_生活投资统一入口_2026-10-17.md`](../../qiqi/docs/随手记_生活投资统一入口_2026-10-17.md)
