# 投资页标点与产品导航Logo · 2026-10-22

按用户三处浏览器标注作局部修订：

- 投资页主标题改为“看清风险”和“再向前一步”，删除逗号与句号，保留原有两行布局。
- 副标题仅删除末尾句号，显示“让每一次组合调整，都有可追溯的依据”。
- 产品导航页品牌整体替换为之前主页使用的透明彩色Logo，直接复用原PNG，SHA256为 `fba7a4e1b36b9f8f40057cf655f446009c5943bd6bbfbd1d0f3d6d0b14b246d6`。

两页共用的产品样式补充Logo尺寸：宽屏80px，900px及以下56px。仅4个静态文件变化：`investment.html`、`catalog.html`、`versions/product-overrides.css`、`release-manifest.json`；未修改业务或模型调用脚本。

本地Chrome验证375/840/1440px两页共6种状态：指定文案准确、Logo加载且尺寸正确、无横向溢出，产品导航进入投资页、开始检查进入输入区的真实点击均通过。结果见 `local.json` 与 `local-*.png`。

所有发布清单哈希核对通过，Logo原文件逐字节保留。发布沿用独立Worker、既有环境变量和Secrets，不提交登录或模型表单。

已发布版本 `54ae8bfa-a973-42b5-a35b-ab6e95c998d1`，仅上传4个变化的静态资源；编译检查通过，部署记录见 `deployment.json`。线上同样通过375/840/1440px两页共6种状态与实际跳转检查，5个资源（含原Logo）的完整字节与发布副本一致，无脚本异常，模型请求0次。见 `online.json` 与 `online-*.png`。健康检查HTTP200、configured=true、paidEnabled=true。

验收入口：[投资页](https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment?v=20261022-brand-proof#overview)、[产品导航](https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/catalog?v=20261022-brand-proof)。
