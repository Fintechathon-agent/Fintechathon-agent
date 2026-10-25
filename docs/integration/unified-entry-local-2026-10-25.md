# 统一入口 P0：本地修复与线上接线边界（2026-10-25）

## 本轮修复

本机访客页顶部自然语言入口的账单、转账继续调用 `/api/scenarios/run`。理财意图由该接口返回 `delegated: true` 后，前端将原问题交给现有 `/api/review` 流程，展示任务计划、风控和审批状态；用户无需复制到第二个输入框。委派不清空银行待确认事项，也不把审查已发起误写为执行成功。

同一签名访客会话的账单分析、700 元待确认转账和理财审查已通过真实本机 HTTP 测试。测试确认转账后投资侧读取同一现金余额。本轮 `tests.test_guest_accounts` 为 12/12 通过；其中新增的三场景用例是该总数的子集。前端脚本通过 Node 语法检查。`all_scenarios_click_smoke.js` 增加理财委派后确实发出 `/api/review` 的断言；当前工作环境未安装 Playwright，尚未运行该浏览器脚本。

## 尚未达到的验收条件

这是 **Finance 本机统一输入入口**，不是公开主聊天的三场景同任务闭环。`guest_gateway.py` 刻意禁用真实模型和远程 Core review；本轮没有接团队 staging、可信最终用户身份或线上存储。账单、转账和理财在同一访客会话中运行，但没有证明它们共享 Core/Risk 的同一个 `task_id`。不能把本轮修复描述为公开主聊天已接通。

2026-10-25 重新 `git fetch origin --prune` 后，`origin/main` 与可见团队分支仍未找到 `personal-ai-fund-chat`、`/api/local` 或 `LLM_A_API_KEY` 的实际实现。需要主聊天 Owner 提供当前部署对应源码的仓库、分支、Commit SHA、构建入口及团队 staging 的准确 Worker/绑定。取得后应先把三个场景映射到同一可信用户和任务契约，再以同一 staging SHA 跑正常、拒绝、故障、重放和跨访客负例；通过后才能关闭此 P0。

## 复核命令

在 `qiqi/` 下使用可写的临时目录，运行：

```powershell
$testTmp = (New-Item -ItemType Directory -Force -Path '.test-tmp').FullName
$env:TEMP = $testTmp
$env:TMP = $testTmp
.\.venv\Scripts\python.exe -m unittest tests.test_guest_accounts -q
node --check web/static/banking.js
node --check tests/all_scenarios_click_smoke.js
```

浏览器脚本需要预先安装 Playwright 并启动本机访客服务：`node tests/all_scenarios_click_smoke.js`，`TEST_URL` 指向该服务。它只检查前端实际请求和显示，不替代团队 staging 联合验收。
