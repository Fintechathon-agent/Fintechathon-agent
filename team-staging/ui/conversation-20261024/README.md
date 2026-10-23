# 生活与投资对话 · 本地百炼真实联调候选

本候选复用队友现有对话后端，在最新个人预览上增加“生活与投资”窗口。顶部导航与首页 02 卡片进入 `conversation.html`，保持首页现有水池修复、暖橙/深色设计、原背景构造与彩色 Logo。

本轮仅更新个人预览与本目录，不修改 team-release、团队 Core、Risk、审批、执行或既有数据库；不购买服务，不正式部署。HTTPS 与保留策略提案见 `docs/contract-proposals/2026-10-24-conversation-hosting-retention.md`。

## 来源与实现

- 对话来源：`jinyihan77-create/finance-lab-demo` / `codex/conversation-backend` / `60f763831c238cbacdd0580de362743b7327c93c`。
- 网页基线：个人 `finance-lab-ui-preview` / `preview` / `a3587d43d194eff650da01d5a89bbddc4d615b3d`。
- 本轮个人预览提交：`abcd197d370174ec475699d82eb5f27ffff8a820`，已推送并核对远端一致。
- 团队本地基线：`e0e74faf66e75d547cd08d47a4c1c238b459a3a3`；核对远程 main 为 `46041e5526f97c0956798315d5caceb653615208`，没有 merge 或覆盖该分支。
- `vendor/conversation/` 是对话服务来源快照。唯一依赖修复是 `assistant/storage.py`：SQLite 上下文在提交/回滚后显式关闭连接，解决 Windows 测试销毁临时数据库的占用问题，不改变表结构或数据语义。
- `vendor/provider/` 是本机原有 `chenchen/integrations/local-review.js` 与 `model-review.js` 的只读复用快照；原文件未修改。使用原有模型身份、JSON 六字段、动作枚举、禁用规则回退与脱敏规则。
- `run_local.py` 用原服务与原 `Assistant(reviewer=...)` 注入点提供本机同源服务。百炼通过后端 Node 子进程调用，本地每分钟最多 5 次且只允许一个模型请求；不自动重试，不自动切模型，不增加交易权限。不存在公网部署或生产认证承诺。
- 前端将 JSON 编辑器、原始响应与工具证据、只读交接调试说明从页面展示中收起，保留必要持仓输入和检查入口；加载失败改为可理解的提示，不展示 JSON 解析栈。此处没有宣称已把组合模块的数据迁移到数据库。

## 真实调用证据

`evidence/direct-provider.json`：HTTP 200，`qwen3.8-flash`，14614ms，1213 tokens；供应商响应 `chatcmpl-c4c7914e-2cfd-9521-b13a-334e2645a315`。

`evidence/live-browser.json`：浏览器 → `/api/assistant/message` → 本地后端 → 百炼 → 网页显示成功；模型 HTTP 200，28294ms，2443 tokens，响应 `chatcmpl-25aef5d8-6cb0-932e-a4f5-9fbf8a437233`，运行编号 `review-f0fcf22e-153c-45a3-82d7-738fee3286ef`。断言网页文本包含供应商原始 JSON 的 `action_reason`；同请求去重返回 duplicate，不再次调用供应商。每次真实验收均为单次请求，未使用 Mock AI；验收问题是明确的虚构资料。

模型确实返回有效分析，但输出仍偏谨慎，不等于投资适当性或完整风控验收。生活记账仍是规则解析；用户明确提出分析时才调用模型。

## 测试与边界

- 59 项来源回归通过，另有缺失配置失败与只读清理报告 2 项检查；单元测试不作为真实模型证据。
- 9 种宽度 320–1920px：导航和 02 入口、无横向溢出、共享 Logo/背景/配色、原水池不遮挡数字。
- 真实浏览器检查：记账、纠错、SQLite 刷新恢复、断网草稿、CSV、Cookie HttpOnly、会话隔离、跨站拒绝、私有文件不可访问。
- 缺失本地 Key 的负面检查确实经后端返回配置失败 503，消息仍能保存；前端为 `model_unavailable`，不产生模型结论。聊天保存 HTTP 200 与供应商调用状态分别记录。
- SQLite 文件是本次新建的 `runtime/assistant.sqlite`，既有数据未动。`runtime/provider-calls.jsonl` 是后端本地诊断，不在前端显示、不入 Git；提交的验收证据仅含合成资料与脱敏结果。
- `retention_report.py` 只读扫描，自动清理关闭，删除数量为零。正式清理规则待确认。
- GitHub Pages 上只提供 UI，配置为 endpoint=null，显示服务待启用并禁用发送，不将页面发布当作后端上线。
- 个人预览的 Pages 任务 `39993676810` 成功。线上 9 种宽度、12 个实际发布文件 SHA256、诊断信息隐藏与零财务 API 请求检查通过，见 `evidence/online-browser.json`；375/840/1440px 线上截图已逐张检查。

## 本机运行

用途：使用现有本机百炼配置和最新网页目录启动同源服务。需要 Python 3.10+、Node.js 22+。不复制或输出环境文件。

```powershell
python run_local.py --site-root <个人预览仓库绝对路径> --env-file <本机服务端配置文件绝对路径> --port 8887
```

本次已启动入口：`http://127.0.0.1:8887/landing.html`；对话页：`http://127.0.0.1:8887/conversation.html`。

`frontend/` 是本轮前端覆盖包；`release-files.json` 记录 Git 规范字节 SHA256；`sources.json` 记录来源与依赖哈希。复制前必须确认目标基线，不覆盖他人改动。

用途：复验页面及本地接口。只有显式添加 `--live` 才会再次产生一次真实模型请求；正常复验不要重复付费验收。

```powershell
node tests/browser.cjs
python -m unittest discover -s tests -p test_integration.py -v
python retention_report.py runtime/assistant.sqlite
```

来源回归使用 `python tests/run_upstream.py <来源仓库绝对路径>`。执行浏览器检查前将 NODE_PATH 指向含 Playwright 的依赖目录。生产部署准备与未完成事项见前述提案。
