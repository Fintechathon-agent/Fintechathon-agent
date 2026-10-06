# 金融比赛 · Finance Lab

投资理财与店主财务两种场景，保留原有金融计算与核对流程，采用参考 KOSX 的黑橙视觉。独立比赛演示，使用虚构数据。

![展示首页](chenchen/docs/ui-redesign/landing/landing-desktop.png)

从仓库根目录运行服务（Node.js 22+，无运行依赖）：

```powershell
node chenchen/server.js
```

打开 [展示首页](http://127.0.0.1:4175/)，或直达 [投资工作台](http://127.0.0.1:4175/investment)、 [店主工作台](http://127.0.0.1:4175/merchant)。

- [运行、测试与产品边界](chenchen/README.md)
- [页面地图与设计依据](chenchen/docs/ui-redesign/01-design-and-page-map.md)
- [展示首页与毛玻璃验收](chenchen/docs/ui-redesign/03-landing-and-glass.md)
- [上一阶段交付与验收记录](chenchen/docs/ui-redesign/02-delivery-and-acceptance.md)
- [团队权限风控规划](docs/safety-risk-eval/权限风控规划表-v0.2.md)

当前工作分支：`codex/kosx-landing-glass`（基于已交付的 `codex/kosx-finance-ui`）。本轮只同步团队仓库，修改经测试后提交与推送，主分支由团队审核合并。
