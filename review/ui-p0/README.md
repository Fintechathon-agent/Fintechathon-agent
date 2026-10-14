# 本地验收证据

- baseline-core.txt / after-core.txt：本轮基线修改前后 63/63。
- view-model-tests.txt：11/11 状态、来源、回执与任务关联检查。
- browser-check.json：15 个 Chrome 交互检查；包括显式 TEST FIXTURES，不能当作后端执行证据。
- axe-*.json：四个视图无违规。
- qiqi-tests.txt：95/95 基线 Python 测试。
- risk-pinned-tests.txt：固定 Risk 分支快照 102/102。
- personal-existing-tests.txt：保留原个人 UI 44/45 失败证据。
- smoke.txt：本地运行服务页面和资产一致。
- asset-manifest.json：12 个 UI 资产 SHA256，无 API mock，需现有 Node 服务运行。
- workspace-desktop.png / portfolio-desktop.png / task-desktop.png / task-mobile.png / error-desktop.png：本地服务及异常状态截图。移动截图保留即时状态提示，非公开部署截图。

所有结果对应交付文档所列版本；最新 main 的新增功能未由这些结果验收。
