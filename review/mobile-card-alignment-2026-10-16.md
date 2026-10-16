# 2026-10-16 手机首页双卡片对齐

仅修改 chenchen/versions/landing.css 的 700px 以下样式：统一自适应标题字号与单行标题；卡片使用纵向弹性布局，让说明、标签、底部入口对应对齐；底部入口文字自适应。没有修改文案、业务接口或桌面布局。

Edge 实际浏览器检查 320、375、390、430、700、1024px：标题单行，无文字裁切或整页横向溢出，两卡 h3/p/ul/a 的顶部坐标一致。JavaScript syntax check 与 git diff --check 通过。本次 CSS 局部修复未重跑完整 Node 套件，已有 73/75 记录仍保留，不宣称全绿。微信真机系统放大字体未验证。

最新团队 main 经 GitHub API 核对为 e51ce9bb4e30cd409414ef55f8f9a5eddd065dda，本次不合并或覆盖 main。公开 Preview 保留原有静态服务边界。截图与逐尺寸测量保存在本机 public-preview/cards-mobile-aligned.png 和 card-alignment-checks.json。
