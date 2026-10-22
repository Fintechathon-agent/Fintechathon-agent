# 首页透明 Logo · 2026-10-22

用户要求将独立首页左上角的 K / FINANCE LAB 换为提供的彩色图形，只显示 Logo 本体，去掉黑底。

## 图像交付

- 编辑目标：用户原图 `logo设计/微信图片_20261011122936.png`。
- 使用内置 imagegen，background-extraction 编辑，transparent_background=true；未使用 CLI。
- 输出：`team-staging/ui/tinglan-ai-20261018/public/investment-only/versions/landing-logo-transparent.png`，1254×1254 RGBA PNG。
- 检出 1,021,412 个全透明像素，保留 Alpha 通道；在浅色和深色背景上检查图形外侧及镂空区域。对照见 `alpha-background-proof.png`。
- 新建独立素材，不覆盖原图，也不替换其他页面已有 Logo。

最终提示词：

> Use case: background-extraction. Edit target: the attached original blue-and-gold metallic logo on solid black. Produce a faithful transparent PNG cutout containing ONLY this exact logo body. Remove the solid black background completely, including all black negative spaces inside and between the circular head, blue upright ribbon, gold arrow and circular yuan-like lower loop. Preserve the original exact geometry, proportions, navy blue and orange-gold gradients, metallic texture, original highlights, thin edge outlines and all internal pieces. No redesign, no simplification, no added text, no surrounding frame, no new shadow, no glow halo, no white or black matte. Clean antialiased edges; genuine alpha channel, not a checkerboard image. Frame the entire mark tightly with only small transparent padding so it can be used as a website header logo. Keep the artwork identity unchanged.

## 页面调整与验证

首页品牌链接中仅保留图片，移除原 K 和 FINANCE LAB 文字。桌面图片框 68px，手机 56px，按比例显示。导航根据屏幕内提示条的实际高度避让，避免小屏提示条换行后遮挡 Logo 和工作台按钮；滚动离开提示条后恢复原顶部间距。

本地与线上检查 320、375、840、1440px：图片加载、无横向溢出、提示条不遮挡导航、滚动后间距恢复、工作台入口可点击、页面无脚本异常。结果与截图见 `local.json`、`online.json` 及同名前缀 PNG。没有发起真实模型调用。

JavaScript 检查与 Worker 编译通过，源码与运行候选各 33 个发布摘要核对通过。部署保留原有变量和会话配置；线上文件字节与运行候选一致，记录见 `deployment.json`。

线上入口：https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/landing?v=20261022-alpha
