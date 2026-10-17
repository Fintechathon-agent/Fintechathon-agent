# Finance Lab · 暂存交付说明

- 维护账号：`jinyihan77-create`（仅使用账号标识）
- 阶段：已本地自动化验证，待团队联合验收；不代表公网服务或完整产品已经上线。
- 源目录：[`qiqi/`](../../qiqi/)
- 源提交：`1d97ac237127e5713019bede57ef0662aba5beb2`
- 变更范围：银行六场景路由、自然语言意图与任务 DAG、黄色/红色确认、原子账本与回执、审批一次性执行、熔断持久化、模型 demo/live 透明状态、测试和审计证据。

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

当前 JSON 接口和字段对齐见 [API-CONTRACT.md](API-CONTRACT.md) 以及 [`qiqi/docs/模型服务交接_七七-林粹_2026-10-13.md`](../../qiqi/docs/模型服务交接_七七-林粹_2026-10-13.md)。PDF、PPT、Word、Excel 和图形的导出/排版适配尚未作为本模块的已交付能力；当前 UI 消费结构化 JSON、风险闸门和审计证据，后续统一由 UI Owner 按这份契约接入。

## 实际验证

- `python -m unittest discover -s qiqi/tests -q`：154 项通过。
- `python qiqi/tests/run_isolated_checks.py`：单元测试与安全评测均通过，固定样本 54/54 拦截、0/20 误伤。
- Python/JavaScript 语法检查：通过。
- 浏览器脚本与既有 1440px/390px 证据已保存在 `qiqi/artifacts/safety-fixes-2026-10-16/`；本次环境未安装 Playwright，因此未重新执行浏览器脚本，不能把本轮写成浏览器复验通过。

## 已知边界

强验证仍是 Mock；外部银行、短信、人脸、商户下单和公网后端未接通；真实模式没有 Key 时返回 `MODEL_UNAVAILABLE`，不会静默降级为规则成功。跨模块接口、Memory 写入和 Risk 联合验收仍需 Owner 确认。

## 转入正式区

团队确认接口字段、运行路径和联合验收记录后，把本入口登记的同一来源提交同步到 [`team-release/finance-lab/`](../../team-release/finance-lab/)，并在正式版本记录中写明测试和回滚依据。

## 教师模型行为蒸馏

当前仅登记方案，不代表已经训练或接入生产：[REVERSE-ENGINEERING-DISTILLATION.md](REVERSE-ENGINEERING-DISTILLATION.md)。
