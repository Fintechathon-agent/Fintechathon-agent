# 首页数字与水池分离 · 2026-10-24

按用户对预览首页的标注，将两张工作卡的数字保留在左边、水池放在右边，避免遮挡。

原因是 `.archive-diagram>span` 同时选中了数字和水池：数字的 `left:0` 覆盖了水池原有的 `left:38%`。本次为四条数字样式增加 `:not(.liquid-vessel)`，恢复水池原定位。手机版仍使用原有的 46% 左偏移与 54% 宽度。首页更新样式缓存版本，发布清单同步更新相关文件哈希。

- 修改基线：个人预览 `preview` 分支 `26410016d64884c86fea178943b0f922fef484f9`。
- 布局提交：`5e77529c7a4b84b89ad87dad1cd71c4720cf33ce`；最终发布提交：`a3587d43d194eff650da01d5a89bbddc4d615b3d`，推送后与远端 `preview` 一致。最后一笔提交修正 Windows 工作副本换行与 Git 发布字节不同导致的清单哈希偏差，页面代码无追加改动。
- 验收入口：[预览首页](https://lixjanus526-art.github.io/finance-lab-ui-preview/landing.html?v=20261024-pool-layout#explore)。
- `site/` 为三个发布文件的精确副本；`release-files.json` 记录 SHA256；`pool-layout.patch` 可在基线上复现修改。
- 团队仓库仅新增本目录，沿用 `codex/workspace-minimal-20261021` 与草稿 PR #26。

## 检查

`check.cjs` 使用真实 Chrome 检查 320、375、430、700、701、720、840、1024、1280、1440、1920px 共 11 种宽度：数字与水池至少有 4px 间距、水池不越界、水面画布已绘制、标题和入口保持对齐、页面无横向溢出。并检查两个整卡跳转与非减弱动态模式下硬币至少一次落入水池，收集脚本异常。线上模式额外逐字节核对三个发布文件的 SHA256。

本地全部通过，见 `evidence/local.json`。375/840/1440px 截图已逐张检查。团队项目 `node chenchen/scripts/check.js` 与新增检查脚本的语法检查通过。线上 11 种宽度、两个整卡跳转、硬币动画、三个发布文件哈希均通过，脚本异常为零，见 `evidence/online.json`；线上三张截图亦已逐张检查。最终 GitHub Pages 发布任务 [39990065675](https://github.com/lixjanus526-art/finance-lab-ui-preview/actions/runs/39990065675) 成功。

用途：复验本地发布目录，或核验在线预览。需 Node.js、Playwright、Chrome，运行前将 `NODE_PATH` 指向包含 Playwright 的依赖目录，将 `PREVIEW_ROOT` 指向预览仓库本地路径。

```powershell
node review/workspace-minimal-20261021/pool-layout-20261024/check.cjs
node review/workspace-minimal-20261021/pool-layout-20261024/check.cjs --online
```

本轮只修首页视觉布局；没有接入对话后端，不涉及模型调用或共享 Contract。
