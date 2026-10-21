# 发布与验收记录

日期：2026-10-21（北京时间）。

## 个人预览

- 仓库：`https://github.com/lixjanus526-art/finance-lab-ui-preview.git`
- 分支：`preview`
- 本轮提交：`c529294bf0fe78c205d9ef372ef75d6b5ead152e`
- 已通过Git推送，未强推；发布前远端基线为 `57e0a6bccd890b00c8599d8bd64b62569fe3d196`。
- 验收入口：`https://lixjanus526-art.github.io/finance-lab-ui-preview/landing.html?v=20261021-minimal`
- 四个窗口：`workspace.html#workspace`、`workspace.html#banking`、`workspace.html#tasks`、`workspace.html#safety`。
- GitHub Pages构建成功，运行编号 `39548507452`，对应本轮提交。
- 线上Chrome复验375/1440px共8个窗口状态，页面HTTP200、无横向溢出、无脚本异常；整卡点击通过。页面、导航脚本和配色样式的线上SHA256与本轮发布包一致。记录见 `evidence/online-verification.json`，结果 `PUBLISHED_UI_VERIFIED`。

## 团队仓库

- 仓库：`https://github.com/Fintechathon-agent/Fintechathon-agent.git`
- 本轮分支：`codex/workspace-minimal-20261021`
- 本轮只新增 `review/workspace-minimal-20261021/`，保存覆盖包、可复现转换、测试和证据。
- PR以原受保护候选分支 `codex/tinglan-secure-ai-20261018` 为base，保持draft；不合并main，不修改原PR #23或任何Owner后端文件。
- 团队SHA及远端一致性在最终交付消息报告，避免在该提交正文写入自引用SHA。

## 测试结论

- 本地七种宽度、四个窗口、整卡点击、键盘、深链、输入保留、前进/后退和服务失败状态通过；静态投资演示三方案保留。
- 四个窗口axe检测0违规；无页面脚本异常；Logo图片SHA256与基线一致，首页与侧栏Logo元素HTML与基线完全相同。
- 发布暂存区13个文件均与已审查覆盖包SHA256一致；两份发布清单校验的是Git实际发布字节，保留原有换行格式。
- 千问真实API：1次调用、HTTP200、853ms、33tokens、返回 `API_OK`。证据 `api-retest.json`。
- 当前云端工作台域名直连超时；此次未完成网页到Worker再到百炼的链路复验。此项与API本身有效分开报告，既有受保护入口仍保留。
