# 统一任务与安全状态 UI 集成候选

日期：2026-10-27，北京时间。状态：可审查、可本机演示，正式Core/Finance/Risk/审批联合验收待Owner确认。没有部署，没有真实资金执行。

原先投资健康检查和千问候选任务分开展示，本候选复用既有六模块，把服务端已知任务、原始追踪、风险/审批/回执和事件关联起来。问题、来源范围或数据版本变化会撤销发送授权、标记旧结论失效；超时保留原请求，只读查询，不自动重发模型或资金操作。

- 个人来源：`lixjanus526-art/finance-lab-ui-preview`，分支 `codex/p0p1-task-safety-20261027`，已推送提交 `a25896680ea0f27f80201f48c44034e1bfb73669`。
- 团队基线：main `fa53166cec9e3fb1ee4d720a31e3066bcc3f3c66`；本分支 `codex/ui-task-safety-20261027`。
- `frontend/` 为个人提交的Git完整归档，不覆盖团队现有前端、Owner源码或其他候选；来源和摘要见 [SOURCE.json](SOURCE.json)。
- [完整审计、文件作用与测试](frontend/REVIEW-2026-10-27.md)、[演示与Owner交接](frontend/OWNER-HANDOFF-2026-10-27.md)、[正式接线缺口提案](../../../../docs/contract-proposals/2026-10-27-ui-task-query-approval-boundaries.md)。

## 证据

| 检查 | 结果 |
| --- | --- |
| 团队现有Core | 284/284，通过；固定main源码，未改后端 |
| 原本机候选服务 | 7/7，通过；没有付费模型请求 |
| 新UI/契约专项 | 36/36，通过；真实Core确定性诊断，Risk/审批/PAPER使用明确测试替身 |
| 浏览器 | 七种宽度×六导航，无页面横向溢出；任务/审计关联、授权撤销、刷新、键盘焦点、XSS、401/403/409/423和UNKNOWN恢复均实际运行 |
| 资源完整性 | 86个运行资源的SHA256与个人Git提交字节一致；Windows行尾按清单注明口径处理 |
| Finance原回归 | 171项，170通过、1项日期断言失败：2026-10-27运行仍固定期待2026-10-25；没有修改Finance源码 |
| 敏感信息 | 凭据模式及禁用文件名扫描无命中；未读取环境密钥或上传真实财务资料，不宣称完整渗透测试 |

本轮截图及原始测试见 `frontend/evidence/`；初次失败记录也保留，最终结果明确区分。团队归档复验见本目录 `evidence/`。

## 仍未实现的正式链路

旧千问公网 `/health` 已配置 `qwen3.8-flash`，但统一任务状态接口404；本轮没有新付费推理。Core/Risk云联调健康200，业务接口401，Risk报告模型关闭、联合验收false。服务端签名/模型配置不等于最终用户审批或业务完成。

前端只读消费既有investment-agent.v1、review-workflow.v1和隔离候选接口，不将Finance同名 `/api/review` 或候选状态替换正式Core协议。共享可信账本、账户版本、同源用户代理、本人批准和唯一PAPER执行网关，由对应Owner补齐；所有UI执行入口保持关闭。

## 本机复验

用途：在前端归档目录执行语法、专项和静态预览；CORE_SOURCE指向本团队checkout的chenchen目录。不会发送付费模型请求。浏览器脚本需要测试环境Playwright/Chrome。

```powershell
cd frontend
npm run check
$env:CORE_SOURCE='<team-checkout>/chenchen'
npm test
npm run preview
```

用途：与原Core确定性演示联调，按Owner交接文档启动Core后，在另一个窗口设置本机回环代理。

```powershell
$env:CORE_URL='http://127.0.0.1:4175'
npm run preview
```

访问 `http://127.0.0.1:8917/workspace.html`。静态预览不等于线上Staging，不把测试替身或本机成功写成公网验收。

## 审查与回退

仅审查本新目录及Contract缺口文档。保持草稿PR，不自动合并main、不进入team-release、不部署或更改公开preview。回退时停止本机候选并保留任务/审计证据，不删除记录或自动重发UNKNOWN。对应Owner需在团队认可渠道记录确认，之后再安排正式集成。
