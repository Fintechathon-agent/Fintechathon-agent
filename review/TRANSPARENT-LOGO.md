# 透明 Logo 替换

用户于本轮明确要求移除黑底，覆盖此前网页必须保留黑画布的显示要求。原始 PNG 仍保留，未覆盖源文件。

使用 imagegen 内置编辑工具从附件生成透明派生 PNG（1254 × 1254），不属于原始字节一致资源。采用提示：仅去除纯黑背景和图形间空隙，保留轮廓、比例、深蓝金橙色及纹理，不重设计。选用第一版去背输出。

派生资源 SHA-256：fba7a4e1b36b9f8f40057cf655f446009c5943bd6bbfbd1d0f3d6d0b14b246d6。

旧版首页、投资页、店主页仅替换左上角标识及局部图片样式；首页大 K 装饰不在此次指定范围。静态构建复制 PNG，服务器仅补充静态资源白名单与 MIME，不修改 /api。商户功能未扩展。

对应旧版官方仓库分支 codex/transparent-logo-pages 基于 codex/kosx-landing-glass；第三阶段分支同步修改独立风险闭环及双工作台。没有覆盖 F:/人工智能AI 比赛 原工作区的未提交成果。

验证：旧版 node --test 46/46；新版 57/57；语法检查；桌面1440/手机375共14组图片 URL、响应哈希、alpha、等比例及无横向溢出检查。截图见 review/transparent-logo/。当前为功能分支与本地预览，不代表 lixjanus526-art.github.io/finance-lab-demo 已部署更新。

旧版预览：http://127.0.0.1:4330/、/investment、/merchant。
风险闭环：http://127.0.0.1:4320/xinlan/journey.html#entry。