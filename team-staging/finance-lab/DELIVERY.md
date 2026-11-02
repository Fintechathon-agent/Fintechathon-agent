# Finance Lab · 暂存交付说明

- 维护账号：`jinyihan77-create`（仅使用账号标识）
- 阶段：已本地自动化验证，待团队联合验收；不代表公网服务或完整产品已经上线。
- 源目录：[`qiqi/`](../../qiqi/)
- 源提交：`90dcec4`（接入团队统一后端 Core Agent）；上一登记来源 `1401d84`、`1d97ac2`
- 变更范围：银行六场景路由、自然语言意图与任务 DAG、黄色/红色确认、原子账本与回执、审批一次性执行、熔断持久化、模型 demo/live 透明状态、测试和审计证据；报告产物统一导出契约；随手记统一入口；MCP 能力中心；本次新增团队统一后端适配层（`web/core_agent.py`）与两条联调路由。

## 本地运行

在团队仓库根目录执行：

```sh
python -m unittest discover -s qiqi/tests -q
python qiqi/tests/run_isolated_checks.py
python -m compileall -q qiqi/agent qiqi/contracts qiqi/demo qiqi/evals qiqi/tests qiqi/web
cd qiqi
python web/app.py --port 8765
```

启动后可访问 `http://127.0.0.1:8765/`、`/compare`、`/static/v2/index.html` 和 `/evidence`。演示模式使用固定演示数据，不连接真实银行账户，不产生真实资金动作。

## 模型与接口

模型服务使用 OpenAI-compatible HTTP 形式；默认 DeepSeek，配置名为 `DEEPSEEK_API_KEY`、`llm.base_url` 和 `llm.model`。Plus 订阅与 Agent API 额度是两条独立计费链路，仓库只读取启动环境显式提供的 Key，不读取本机凭据文件。

当前 JSON 接口和字段对齐见 [API-CONTRACT.md](API-CONTRACT.md) 以及 [`qiqi/docs/模型服务交接_七七-林粹_2026-10-13.md`](../../qiqi/docs/模型服务交接_七七-林粹_2026-10-13.md)。

报告产物已交付**统一渲染契约**（`qiqi/contracts/report.py`、说明见 [`qiqi/docs/导出契约_2026-10-17.md`](../../qiqi/docs/导出契约_2026-10-17.md)）：agent 只产出 `ReportArtifact`，PDF / PPTX / DOCX / XLSX / PNG 渲染器与 UI 消费同一份结构，不各自定义导出数据。**渲染器本身尚未实现**——契约已可被三方引用，导出能力待开发，不能表述为「已支持导出」。

## 实际验证

- `python -m unittest discover -s qiqi/tests -q`：222 项通过（含 10 项统一后端适配测试、15 项随手记、26 项 MCP）。
- `python -m unittest discover -s qiqi/tests -p "test_report_contract.py" -q`：17 项通过，覆盖表格列数、图表点数、饼图单序列、外链图片、demo 无免责声明、live 混 demo 来源、JSON 往返。
- `python qiqi/tests/run_isolated_checks.py`：单元测试与安全评测均通过，固定样本 54/54 拦截、0/20 误伤。
- Python/JavaScript 语法检查：通过。
- 浏览器脚本与既有 1440px/390px 证据已保存在 `qiqi/artifacts/safety-fixes-2026-10-16/`；本次环境未安装 Playwright，因此未重新执行浏览器脚本，不能把本轮写成浏览器复验通过。

## 统一后端接入（2026-10-20）

- 后端：`https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev`（团队 Cloudflare Worker）。
- 只读探活 `GET /api/core-agent/status`；真实复核 `POST /api/core-agent/review`。
- 实测：`/health`、`/api/review/capabilities` 返回 200；`POST /api/review` 返回 `PENDING_RISK`，模型真实返回 `HOLD_FOR_REVIEW`，`execution_allowed=false`、审批 `BLOCKED`。
- 失败不回退：后端非 2xx、网络不可达或返回非法 JSON 时，路由原样返回错误状态，不切换到规则引擎。
- 配置：`CORE_AGENT_BASE_URL`、`CORE_AGENT_API_KEY`、`CORE_AGENT_TIMEOUT`、`CORE_AGENT_PROXY`（仅本机调试）。不提交任何密钥。
- 边界：本侧 `/api/review` 保持原有本地链路；统一后端是并列路由，未替换演示主线；正式 Risk Owner、审批与执行网关仍未接通。

## 已知边界

强验证仍是 Mock；外部银行、短信、人脸、商户下单和公网后端未接通；真实模式没有 Key 时返回 `MODEL_UNAVAILABLE`，不会静默降级为规则成功。跨模块接口、Memory 写入和 Risk 联合验收仍需 Owner 确认。

导出契约已定义并通过结构校验，但 **PDF / PPTX / DOCX / XLSX / PNG 渲染器尚未实现**；当前只能声明「导出接口已统一」，不能声明「已支持导出文件」。按 10-17 会议口径，后续统一制作的最终 PPT 也应消费同一份 artifact，不另起结构。

## 转入正式区

团队确认接口字段、运行路径和联合验收记录后，把本入口登记的同一来源提交同步到 [`team-release/finance-lab/`](../../team-release/finance-lab/)，并在正式版本记录中写明测试和回滚依据。

## 教师模型行为蒸馏

当前仅登记方案，不代表已经训练或接入生产：[REVERSE-ENGINEERING-DISTILLATION.md](REVERSE-ENGINEERING-DISTILLATION.md)。
