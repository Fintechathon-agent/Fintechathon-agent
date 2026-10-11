# 周四交付：界面架构、需求提案与首页方向

日期：2026-10-08。入口：[独立原型](index.html)。可以直接用浏览器打开本目录 HTML；使用本地服务时可分享带 `?direction=A`、`B`、`C` 的本机地址。没有连接业务后端、外部字体或第三方服务。

## 打开与操作

从仓库根目录启动只读本地预览服务（仅监听本机，不是公网发布）：

```powershell
node review/home-directions/serve.cjs
```

- A：[股票 ⇄ 基金 / ETF](http://127.0.0.1:4188/?direction=A)
- B：[风险 ⇄ 计划确认](http://127.0.0.1:4188/?direction=B)，建议方向
- C：[单卡 · 收益 / 风险](http://127.0.0.1:4188/?direction=C)

点击顶部方向切换；点容器可改变装饰液位；“天平回正”恢复；卡片按钮打开入口说明，Esc 关闭并回到原按钮。方向存放在 URL，刷新和浏览器返回均可恢复，没有保存为用户正式选择。需要用户在聊天中明确选择，再改正式首页。

## 三项产物

1. [界面架构](../../docs/finance-ops/ui-architecture.md)：六步 Golden Path、三类界面、Mermaid 数据流、五项安全机制、字段 Owner、实际接入状态。
2. [界面需求提案](../../docs/contract-proposals/2026-10-08-ui-needs.md)：版本分歧、字段差距、JSON 讨论样例、确认人及验收行为。待用户转群 / Wiki，未代发、未确认、未接线。
3. 本目录 A / B / C：A 保留双卡按资产分组；B 保留双卡按风险和用户确认分步；C 单卡内并列收益与风险。三者共用现有黑橙、柔边玻璃、橙色横梁视觉，不改变正式页面。

## 验证与截图

运行针对本轮新增原型的交互、四尺寸、可访问性和 JSON 样例检查；使用仓库现有开发依赖及本机 Chrome，不安装新依赖：

```powershell
node chenchen/scripts/ui-directions-check.cjs
```

覆盖 1440 / 1024 / 375 / 320，各 A / B / C；检查无横向溢出、容器并排不重叠、注入上限、回正、全部入口弹窗、Esc 与焦点恢复、键盘操作、返回与刷新、未知 URL 输入、减少动态效果、无 API / 外部请求、只读服务隔离、三份 JSON 语法。axe 扫描不等于完整 WCAG 认证。

| 回答的问题 | A | B | C |
| --- | --- | --- | --- |
| 桌面入口如何安排？ | [1440](../../screenshots/home-direction-a-1440.png) | [1440](../../screenshots/home-direction-b-1440.png) | [1440](../../screenshots/home-direction-c-1440.png) |
| 平板是否仍清楚？ | [1024](../../screenshots/home-direction-a-1024.png) | [1024](../../screenshots/home-direction-b-1024.png) | [1024](../../screenshots/home-direction-c-1024.png) |
| 手机能否保持左右天平？ | [375](../../screenshots/home-direction-a-375.png) | [375](../../screenshots/home-direction-b-375.png) | [375](../../screenshots/home-direction-c-375.png) |

机器结果见 [verification.json](verification.json)。检查记录：原型 12 组通过、每组 axe 0 项违规；既有语法检查通过，原有业务测试 46/46 通过。截图另做人工视觉检查。本轮未跑正式动画全套回归，因为正式首页及动画完全未改。Firefox、WebKit、安卓微信真机未覆盖；风险 Owner 原型与正式后端集成未测试。

## 变更说明与小测验

- 本轮新增独立方向原型与文档，没有把店主入口从正式产品提前移除，没有改后端、公共 Contract 或固定风险规则。
- 有固定规则文档，是否代表正式风控接通？**否：发现的是跨模块待确认的提案和固定案例原型。**
- ALLOW 是否等于已确认可交易？**否：用户仍需确认完整计划，可信服务还需校验；当前执行网关未接入。**
- 点击这里的方向 B 是否修改正式首页？**否：只是预览。需要用户明确选择后再实施。**

## 21:00 同步用三行

昨天完成：按仓库记录，已交付手机并排天平、硬币循环和橙色横梁；已有测试与提交记录。

今天交付：第五板块界面架构、跨模块字段提案和首页 A / B / C 独立原型；只读确认 Vesper 固定规则所在分支。

阻塞风险：首页方向待用户选择；固定规则政策、版本化接口、可信确认和回执 Contract 待 Owner 确认，当前不能宣称风控与执行闭环。
