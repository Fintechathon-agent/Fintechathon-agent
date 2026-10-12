# 风控页面接入恢复与上线事实核验

核验日期：2026-10-12（北京时间）。

## 为什么公开站点看不到

https://lixjanus526-art.github.io/finance-lab-demo/landing.html 实际仍是旧版：

- Pages 来源为个人仓库 main 根目录，最新提交 de57a51584d25246e2863a9c88cf5a3a86ba220f，提交日期 2026-10-08。
- 实际首页链接只有首页、投资、店主、目录等，没有风控入口；访问 /finance-lab-demo/risk.html 返回 404。
- 之前接入代码仍留在本地未提交文件中，不在该发布仓库。
- 之前创建的 Sites 项目 appgprj_6ac9f0df0f7481919af7e3c940199f57 本次只读查询：latest_version_number=0，current_live_url=null，current_preview_url=null。项目存在或访问权限公开不代表已有发布。

因此之前完成的是本地集成验证，并非公开网站部署完成。本轮不重写或覆盖原工作区，也不把本地预览称为公开上线。

## 本轮恢复成果

从 codex/transparent-logo-pages 的 e218efe 建立 codex/risk-ui-integration-recovery，独立提交和 PR；恢复既有 risk.html/css/js、risk-handoff.js 与本地适配/检查脚本。没有修改队友的引擎、网关、API、权限或存储逻辑。

集成预览沿用本地既有 upstream 快照（577de77b6ed2909d80b5823d3f65dff22644ccd0）。server.cjs 和 hosting/worker.mjs 的 Git blob 分别核对为 fdbaab0d518991ff83760a948eb8bf53b7bd6ccd 与 262aff70c100c9aed20832198442adfad5c319bc，和该提交一致。未经 Owner 审核不升级其公共 Contract。

入口位置：
1. 首页顶部导航“风控与计划确认”。
2. 首页第二张功能卡“风控与计划确认”，按钮“查看确认与日志”。
3. 投资页侧栏“风控与计划确认”；生成投资报告后显示“查看风险与确认”，带同一 task_id 跳转。
4. 产品目录第二张卡提供同一入口。

页面层级：首页一级、风控工作台二级，单项风险依据/计划详情/审计明细三级。集成入口下线店主导航，原店主页仅保留在旧版标识替换 PR，不扩展店主业务。

此版本实际调用本机队友服务，具有服务端 Risk/Action Gateway/审计和模拟工具回执。它不是四角色员工审核后台，计划确认仍由用户本人操作；访客 Cookie 隔离不是正式 RBAC。固定数据、确定性 Core、无真实资金，不宣称已接大模型或银行。4320/xinlan/journey.html 是另一套纯前端角色演练，不得混称。

## 预览及复现

当前可打开 http://127.0.0.1:8791/，直接入口为 http://127.0.0.1:8791/risk。

在此功能分支根目录启动。第二个参数必须指向具有 modules/safety-risk-eval/server.cjs 的既有 upstream 源码目录；本机路径如下：

```powershell
$env:RISK_UI_PORT='8791'
node chenchen/scripts/preview-risk-site.cjs 'F:/人工智能AI 比赛/output/risk-integration/source'
```

其他成员应检出上方已核验的 upstream 提交到独立只读目录，再传入该目录。UI 脚本只包装静态路由，/api 原样交给 upstream；数据目录为本机临时演示目录。不连接内网 IP 或公网业务服务。

演示顺序：投资页载入样例偏好、开始检查、点击报告后的风险入口；核对相同任务编号及风险原因；对可接受事项逐项确认；确认完整计划；执行模拟、查看回执、重放请求；刷新查看执行/审计恢复。BLOCK/ERROR 与未确认状态不能执行。

## 验证

- upstream node --test：72/72 通过，零失败。
- 10 项浏览器集成检查通过：同任务交接、确认/真实模拟回执/幂等/刷新恢复、输入变更失效、REVIEW 逐项确认、BLOCK、攻击文本零工具调用、无效任务、1440/1024/375 响应式、Axe、首页入口及原视觉资产。
- 截图与完整结果：review/risk-recovery/report.json。
- JavaScript 语法检查通过；透明 PNG 静态资源按二进制提供。
- Logo 上轮已验证：旧页 46 项回归、新页 57 项回归、14 组桌面手机显示检查。旧页 Logo 提交 e218efe 已推送；新版 Logo 提交 23f1b29 已推送。

## 公开发布仍需完成

1. 团队审核 UI 恢复 PR 和其 Logo 依赖 PR；不得自动合并。
2. 确认承载现有 Risk 服务的正式演示地址及版本、Cookie/同源部署条件、云存储配置。GitHub Pages 只能承载静态前端，不能把本机 Node 服务一并发布。
3. 若将 Pages 作为入口，应链接到同源承载 UI+Risk 的已部署站点；不把 localhost、未经确认 IP 或其他服务的 task_id 填入公开入口。
4. 发布后验收实际公开 URL 和完整浏览器流程，之后才可称上线。当前个人 Pages main 未修改，Sites 未部署。

后端或跨域/认证 Contract 变化须按 AGENTS.md 由技术 Owner 明确批准；本轮只整理已有前端接入，不自行扩展接口。
