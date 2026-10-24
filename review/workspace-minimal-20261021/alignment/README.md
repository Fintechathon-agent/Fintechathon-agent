# 首页双卡文字对齐 · 2026-10-21

用户在已发布首页标注：左右两张工作卡的文字保持同一高度。840px宽度下，右侧说明多一行，底部入口比左侧低27.1875px；720px宽度下则是左侧更低。

本次让卡片纵向排列、说明区域自动等高，并保持桌面原有段落间距。标题、说明起点、分隔线及入口对齐；较长文字继续自然换行。没有固定文字高度或截断内容。

- 发布源基线：`69c8b75ad76d130252272d5061286d9e593cee9e`。
- 个人预览分支：`preview`，提交 `aef474b13b12f6164e1e56c067480ef8f62f728e`，已推送且远端SHA一致。
- 验收入口：[首页](https://lixjanus526-art.github.io/finance-lab-ui-preview/landing.html?v=20261021-align)。
- 实际变更仅3个文件：`versions/workspace-refinement.css`增加对齐规则；`landing.html`更新该样式的缓存版本；`preview-manifest.json`更新两项哈希。
- 首页HTML与基线逐字比较，除了样式版本号完全一致；文案、Logo、图形、链接和动画脚本均保留。
- 团队提交仅新增本目录，沿用 `codex/workspace-minimal-20261021` 和草稿PR #26。

## 验证

`check.cjs`使用真实Chrome测量375、700、701、720、800、840、1024、1259、1440px共9种宽度，验证两侧标题、说明区、底部入口的起点与高度；同时检查文字未裁切、页面无横向溢出、整卡点击分别进入投资组合与任务窗口、无脚本错误。

本地全部通过；`evidence/before.json`记录修改前偏差，`evidence/local.json`记录修正后结果。三种宽度的截图位于同目录。原项目 `chenchen/scripts/check.js`（`npm run check`的实际入口）与新增检查脚本的语法检查通过。发布清单36项哈希已与Git实际文件或本轮修改字节核对。

GitHub Pages构建[39574186789](https://github.com/lixjanus526-art/finance-lab-ui-preview/actions/runs/39574186789)成功，对应上述个人预览提交。线上9种宽度、两个整卡跳转均通过，标题/说明/入口起点与高度完全一致，入口高度差均为0px；3个发布文件的SHA256与覆盖包一致，无脚本异常或横向溢出。结果见 `evidence/online.json`，线上截图见 `evidence/online-*.png`。本地对比还确认原标题位置变化为0px。

`site/`是本轮3个文件的精确覆盖包，`release-files.json`记录SHA256。线上检查会逐项校验发布字节与覆盖包一致。

用途：本地预览服务运行于4187端口时复验布局；加 `--online` 复验已发布网页。运行环境需要Node.js、Playwright和Chrome。

```powershell
node check.cjs
node check.cjs --online
```

本轮只调整首页布局，不调用模型API、不部署独立Worker，也不改后端或公共Contract。
