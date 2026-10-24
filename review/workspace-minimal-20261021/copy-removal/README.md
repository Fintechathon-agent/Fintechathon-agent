# 删除首页双卡说明文字 · 2026-10-21

按用户蓝框标注，删除“个人投资顾问”和“我的任务与记录”标题下的两段说明及其段落元素。卡片自然收紧，标题、分隔线和入口保持对齐。

- 只改个人预览的 `landing.html` 和 `preview-manifest.json`；逐字比较确认页面其余内容完全保留。
- 基线：`aef474b13b12f6164e1e56c067480ef8f62f728e`。
- 发布分支 `preview`，提交 `26410016d64884c86fea178943b0f922fef484f9`，已推送并核对远端一致。
- 验收入口：[首页](https://lixjanus526-art.github.io/finance-lab-ui-preview/landing.html?v=20261021-clean)。
- 本地Chrome在375/840/1440px检查段落删除、空白收紧、标题与入口对齐、无横向溢出及两个整卡跳转，均通过，无脚本异常；见 `local.json` 与截图。
- GitHub Pages构建 `39579434600` 成功；线上同样通过三个宽度和两个跳转检查，2个发布文件的字节与本地提交一致；见 `online.json` 与 `online-840.png`。
- `home-copy-removal.patch` 是相对上述基线的完整差异；使用时应先准备对应基线，再在预览仓库执行 `git apply <patch-path>`。
- 本次按用户最新要求替代上一轮“保留说明并等高”的状态；`alignment/` 中的结果为历史证据，其段落高度检查不适用于本次删除后的页面。

团队分支继续使用 `codex/workspace-minimal-20261021`，PR #26保持草稿。
