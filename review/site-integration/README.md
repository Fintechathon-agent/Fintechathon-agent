# 第三阶段证据索引

baseline-node.txt：75/75，集成前最新 main + P0。
after-node.txt：73/75，保留旧根页面资产断言失败（子测试及父测试各计一项）。
site-http.txt：当前 13 个路由及资产类型验证通过。
site-browser.json / browser-run.txt：完整网站路径、任务返回、故障与子路径检查。
site-axe.json：Landing、Workspace、原投资页均零违规。
p0-regression/：P0 浏览器 15 项回归与截图；组件异常覆盖含显式测试 fixture。
model-tests.txt：状态模型 11/11。
python-tests.txt：最新 main 115/115。
smoke.txt：本地运行态路由与资产匹配。
asset-manifest.json / build.txt：工作台前端资产构建，无后端模拟。
PNG：本地实际浏览器截图，不代表已发布。

原测试脚本暂未改动。失败及 PR 前需要 Owner 更新的 UI 预期见上级交付文档。
