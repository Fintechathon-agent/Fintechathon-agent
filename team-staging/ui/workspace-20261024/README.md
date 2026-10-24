# 昕澜六模块统一工作空间候选

本候选延续现有页面与黑/灰/橙设计，不修改正式 Core、Risk、Approval、Audit 服务，不更新 team-release，不正式部署。

用户在本轮明确批准隔离实现只读上下文分析、本地草案/事件持久化；正式接口、数据库 Schema 与风险策略仍等待对应 Owner。起始审计见 `AUDIT.md`，边界见 `docs/contract-proposals/2026-10-24-unified-workspace.md`。

个人预览最终提交：`ebd3a190f727d8060f12a9224b3e157084f7b43e`（分支 `preview`）。线上仅发布静态Shell；真实候选入口为 `http://127.0.0.1:8887/workspace.html`。

## 可操作路径

1. 进入 `workspace.html`，默认工作台。左侧六入口固定；Landing 保留介绍与进入入口。
2. 在“生活与投资”记账或补充预算，填写可选储蓄目标。本机账本来自原 SQLite 服务；对话、编辑、导出与历史会话继续使用原逻辑。切换模块不重载同源内容组件；原独立入口跳转至统一Shell，`?standalone=1` 保留原版排错入口。
3. 在工作台、投资组合或生活模块发起分析，选择来源。明确区分 FIXTURE 持仓、USER_REPORTED 预算、USER_DRAFT 目标，缺失数据保持空。确认发送前可查看本次范围。
4. 只读适配器重新读取服务端来源并校验版本；用已有百炼配置分析，不通过记账消息传上下文，不修改账本，不自动重试模型。
5. 分析页展示模型结果、来源快照与时间；可核对持仓、预算，或明确确认生成资料核对任务。
6. 我的任务显示服务端候选任务 `WAITING_OWNER_RISK`，资金执行为false。安全记录双向关联同一sessionId、analysis/run ID、task ID、sourceHash和事件时间；工作台显示任务计数更新。

## 六模块实际状态

| 模块 | 已联通 | 保留限制 |
| --- | --- | --- |
| 工作台 | 共享来源、问题草稿、跨模块分析、任务计数 | 当前用户是本机匿名会话，正式角色未知 |
| 投资组合 | 原有Core快照读取、确定性健康检查、结果刷新恢复、发起分析 | 固定虚构持仓，不是银行/券商实仓 |
| 生活与投资 | 原账本与预算、编辑/导出、会话、储蓄目标草稿、分析上下文 | 规则记账不是任意自然语言AI；预算未经账户核验 |
| 千问分析 | 服务端百炼真实调用、冻结来源、用户发送确认、响应关联 | 本机候选，不是公网部署；不改变旧Worker权限 |
| 我的任务 | 服务端候选持久化、显式确认、幂等、关联来源 | 非正式生产任务，等待Owner Risk；不提供资金执行 |
| 安全与记录 | 服务端候选最小事件、敏感操作拦截、来源/分析/任务双向关联 | 不是Owner签名审计或正式RBAC |

## 复用与存储

- `prepare-core.cjs` 只读提取团队 `46041e5526f97c0956798315d5caceb653615208` 的31个运行依赖到被忽略的 runtime 目录，不修改Owner源码、不包含环境文件。独立Core子进程不加载百炼Key；只代理已有组合/健康检查与任务/审计只读查询。
- 原 SQLite `sessions` 表及原 `Assistant(reviewer=...)` 保留。生产数据与 Schema 未修改。
- 新候选状态使用独立、按会话token哈希命名的 JSON 文件，线程锁与原子替换；保存分析、来源引用、候选任务与最小事件，不提供清理入口。审计只存ID、摘要哈希、状态和时间，不重复记录完整敏感正文。
- 私有 runtime、数据库、原始环境配置、Core源码运行快照不入Git。前端不包含Key或私有百炼端点。
- 8887本机原服务升级前已备份SQLite，升级继续使用原文件，不覆盖、不删除现有会话。候选任务存储与原账本分离。
- 浏览器只持久化表单草稿、目标与明确的DEMO；真实模型分析/任务从HttpOnly会话对应的候选服务读取，不将浏览器角色字段当作权限。

## 真实验收

`evidence/live.json`：工作台 + 固定演示持仓 + 本机自述预算 + 目标 → 一次真实 `qwen3.8-flash` → 本地候选 REVIEW → 用户确认 → 任务 + 事件关联。HTTP200，26453ms，2750tokens，供应商响应 `chatcmpl-c6bc5fdd-1ad3-9439-857f-31a400eb9a82`。

分析ID `review-34540b5b-867a-4c80-b19f-fd7bf6807827`；任务 `local-task-073d412d5ff9420a9efedf94f496b304`。网页文本核对供应商 `action_reason`，上下文分析前后账本条数不变；未将Mock或DEMO当成模型响应。正式风险decision为null，不能把本地REVIEW当成Owner决定。

## 检查

- 7种宽度320–1440px的六路由、默认页、返回、刷新草稿、旧入口兼容、生活内容不重载、无横向溢出。
- 真实生活记账/纠错/CSV；Core原健康检查及历史查询形状的结果恢复。没有改写查询响应冒充原运行信封。
- 上下文选择、来源版本校验、跨模块任务/事件关联、独立会话隔离。
- 敏感资金动作BLOCK（本地限制）、执行接口403、跨源403、用户确认必须显式为true；正式Risk未连接不生成ALLOW。
- 7项服务单元检查无模型调用，包含完成分析的去重回放与冲突拒绝；原生活服务59项回归通过。单元测试的UNIT_TEST_FIXTURE不作为真实模型证据。
- `evidence/consent.json` 验证问题/来源变化后撤销发送授权，分析草稿刷新恢复，全程0次POST；来源范围变化不能沿用旧授权。
- `evidence/online.json` 验证最终静态预览七种宽度、六入口与15个发布文件字节，均通过；真实分析按钮保持断开，不将本地成功冒充线上服务。最终Pages任务 `40066441665` 成功，线上截图已逐张检查。

## 修改文件

- 前端：`workspace.html`、`landing.html`、`conversation.html`；扩展原 `workspace.js`、`workspace-investment.js`、`workspace-model.mjs`、`conversation.js` 和品牌样式；新增 `workspace-store.mjs`、`workspace-unified.mjs/css` 与从现有背景分离的 `archive-scene.css`。精确文件及Git规范字节哈希见 `release-files.json`，完整覆盖包在 `frontend/`。
- 候选后端：`run_workspace.py`、`service.py`、`provider-info.cjs`、`prepare-core.cjs`。只增加隔离的 `/api/assistant/workspace/state|analysis|task`，复用原Cookie路径与后端百炼适配器；不向正式Core/Risk追加端点。
- 检查：`tests/browser.cjs`、`tests/test_service.py` 与 `evidence/`；Core运行依赖来源哈希见 `sources.json`，实际源码运行副本保持在被忽略的 `runtime/`。

## 本机启动

用途：准备不可变Core依赖，并在隔离端口提供统一工作空间。需Python、Node.js 22+，本机既有百炼环境文件不上传。

```powershell
node prepare-core.cjs
python run_workspace.py --site-root <个人预览仓库路径> --env-file <本机环境文件路径> --port 8887 --core-port 4190 --assistant-db <原本机账本数据库路径>
```

用途：复验候选；默认不调用模型。仅在明确需要新一次真实付费验收时才添加 `--live`，本轮已完成一次，不应重复。

```powershell
node tests/browser.cjs
python -m unittest discover -s tests -p test_service.py -v
```

浏览器检查需Playwright/Chrome；`TEST_URL`选择本机候选，`NODE_PATH`指向依赖。正式Cloudflare/HTTPS部署、统一账户、Owner风险签名、正式任务/审计落库继续待评审。个人Pages只发布Shell和明确断开状态，不声称后端已上线。
