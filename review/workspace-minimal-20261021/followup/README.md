# 截图三处局部修订 · 2026-10-21

仅按本轮三张截图做局部修改：

1. 删除主页两张工作卡的六个装饰性小标签及其边框，保留原说明正文和工作入口。
2. “探索金融工作台”从页内滚动改为直接进入 `workspace.html#workspace`。
3. 个人投资页及独立千问分享页统一黑灰橙配色。按钮、选中导航、流程状态、标题强调和分布图使用橙色；Logo、结构、输入、计算和接口保持原样。

## 已发布位置

- 主页：`https://lixjanus526-art.github.io/finance-lab-ui-preview/landing.html?v=20261021-focus`
- 静态投资页：`https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html?v=20261021-focus`
- 独立千问分享页：`https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment.html?v=20261021-focus`

截图三来自独立分享页。前一轮只发布个人预览的主题，因此本轮同时更新独立Worker的静态资源。仅上传4个变化的静态资源，未修改或扩展Owner后端、公共Contract、审批及执行逻辑，也未重传或轮换密钥。

部署使用临时配置省略整个本地 `[vars]` 区段，并指定 `--keep-vars`，以保留生产环境变量、额度设置和已存在的Secrets，避免源码默认 `paid=false` 覆盖线上值。该行为依据[Cloudflare官方部署文档](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。部署版本为 `8d7bb50a-a3ef-4b0b-8610-16d0bcd203f0`。部署记录见 `evidence/cloud-deployment.json`。

## 验证与证据

- `check.cjs` 在375/1440px验证六标签已删除、点击主按钮进入正确工作窗口、两个投资页面的背景/按钮/分布图颜色，以及Logo不变、无横向溢出和三种静态方案保留。
- 检查只运行原有明确标示的虚构持仓演示，不提交模型表单。`modelRequests=0`；本轮未产生付费模型请求，不能把UI检查当成新的真实模型调用证据。
- 本地截图与结果见 `evidence/local.json`；线上结果及截图见 `evidence/online.json`。线上检查还核对Worker健康状态、模型配置仍有效、付费开关保留，以及线上主题文件SHA256与已审查文件一致。
- 个人预览以 `c529294bf0fe78c205d9ef372ef75d6b5ead152e` 为基线，只改6个发布文件；覆盖包与SHA256见 `site/` 和 `release-files.json`。
- 团队分支沿用 `codex/workspace-minimal-20261021` 与草稿PR #26，未合并main。提交编号及远端核对结果在交付消息报告。
- 本轮个人预览提交为 `69c8b75ad76d130252272d5061286d9e593cee9e`，已完成Git推送。
- GitHub Pages构建 `39571751121` 对应上述提交，结果success；本轮本地和线上检查均PASSED。线上两个宽度的主按钮跳转、两个投资页面的配色/Logo/三方案演示均通过；Worker health为HTTP200、configured=true、paidEnabled=true，线上主题SHA256与发布文件一致。

用途：复验局部修改，默认连接本机已有的两个静态预览服务；加 `--online` 后验证线上。

```powershell
node check.cjs <personal-preview-root>
node check.cjs <personal-preview-root> --online
```
