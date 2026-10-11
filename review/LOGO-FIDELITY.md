# 原始 Logo 忠实呈现验收

## 恢复状态

工作分支 feature/xinlan-role-workspaces。恢复时工作区干净，本地 6f83add 已保存上轮原图替换，但远端及 PR #10 仍为 5751a7f；本轮提交后一起推送。不重写旧提交，不修改 main，也不改双工作台业务、权限或后端接口。

## 原始资源

- 用户指定原文件名：微信图片_20261011122936.png。
- 项目文件：chenchen/versions/xinlan/team-logo.png。
- 尺寸：1254 × 1254；PNG；像素检查全部 alpha=255，画布角点为纯黑。
- SHA-256：feb9fa2a3ea39e41230ebc67f604141fa7f07c353d2f13b68f91ca43418fbe7b。
- 项目文件、此前接收的附件副本与用户给定哈希完全一致，本轮未修改图像文件字节。
- 无重绘、SVG 替身、去背、颜色调整或图片转码；项目不使用 Next.js 图片优化。

## 网页与 CSS

| 页面 | 当前本地 Logo URL |
|---|---|
| 工作台统一预览入口 / Personal Hub / Risk Console 顶部标识 | http://127.0.0.1:4318/xinlan/team-logo.png?v=feb9fa2a3ea3 |
| 投资页顶部标识 | http://127.0.0.1:4319/versions/xinlan/team-logo.png?v=feb9fa2a3ea3 |

真实统一登录页面尚未实现，不能将预览身份选择器当成登录系统。本轮没有新增认证页面或权限功能。已有两个入口均使用原文件。

移除 Logo 的 10px/8px 圆角。显式采用 object-fit:contain、object-position:center、零圆角/边框/内边距、opacity:1，filter/mask/clip-path/transform 为 none。图片显示为正方形，保留整张黑画布。检查祖先样式和边界，确保其布局不裁掉 Logo。添加基于原图哈希的版本参数，更新旧图引用；本地服务返回 Cache-Control:no-store。旧 K 图标在上轮提交已移除。

favicon 直接引用同一原始 PNG，其哈希同上；没有缩小后的派生文件。

## 实测证据

logo-fidelity-check.cjs 启动已有本机服务和静态预览，以 Chrome 检查 Personal、Console、Investment 在 1440 与 375 宽度下的页面：

- 图片自然尺寸、渲染比例、CSS、原图不透明度和黑画布角点。
- 浏览器实际图片响应字节与 SHA-256，另验证资源 URL 的 HTTP 返回类型与字节。
- favicon 内容一致；无旧品牌文字；页面不横向溢出。
- 6 张截图与完整报告见 logo-fidelity/，报告中的临时端口仅用于独立测试，上表为常驻预览地址。

运行现有 Node 回归及语法检查；未变更任何金融业务测试。全面无障碍或真实服务端授权不属于此次 Logo 验收。

## 内网信息（仅查阅，不连接）

已读取 qiqi/web/launch.py、qiqi/web/app.py 与 chenchen/docs/risk-workbench-integration.md：

- 仓库提供本地 Python HTTP 演示服务，启动默认 host=127.0.0.1、port=8765；app.py 还可能在占用时顺延端口。
- 默认值不是 172.27.253.10 的部署事实；文档没有确认该地址的完整 URL、反向代理、TLS 或 VPN 要求。
- 需技术 Owner 确认：完整协议/域名或 IP/端口/基础路径；对应服务与部署版本；VPN/内网访问条件；身份及会话获取方式；可调用的只读端点与响应 Schema；数据披露和跨域策略。
- 本轮没有对该私有地址发起任何请求，不猜端口、不新增代理、不改跨域或鉴权设置。
