# Holdings Intake

## 项目定位

这是 Personal AI Fund Manager 的独立实验项目，专门负责新用户持仓文件的导入、识别、校验和预览。

它暂时不接入当前投资产品，也不修改 Core Agent、Quant、Memory、Risk 或 UI。后续成熟后，只通过版本化输出 Contract 与主项目对接。

## 为什么单独拆出来

新用户上传持仓涉及文件格式、证券代码识别、成本价、数据日期、隐私和人工确认。如果直接放进当前主链路，会把“持仓输入问题”和“组合健康检查问题”混在一起，导致接口和责任边界不清楚。

## 第一阶段范围

- 支持虚构 CSV 模板作为输入。
- 检查必填字段、数值、重复证券和日期。
- 识别来源类型和数据质量状态。
- 输出逐行错误，不猜测未知证券。
- 生成导入预览，等待用户确认后才输出标准化持仓。
- 保留现金、持仓数量、当前价格、成本价和数据日期。

## 暂不做

- 不连接券商账户。
- 不读取用户密码、验证码或交易授权。
- 不把真实持仓上传 GitHub。
- 不计算收益、回撤、相关性或模拟结果。
- 不替用户判断买卖方案。

## 输入模板

示例文件：`data/sample-holdings.csv`

```text
snapshot_date,cash,instrument_id,name,asset_type,quantity,current_price,cost_basis
2026-10-09,10000,DEMO_EQUITY_ALPHA,示例权益资产,stock,100,47.2,50.0
```

其中 `cost_basis` 可以为空。为空时，后续主产品只能分析当前配置，不能声称计算了用户的真实盈亏。

## 后续输出 Contract 草案

```json
{
  "contract_version": "holdings-intake.v0",
  "import_id": "import-demo-001",
  "status": "READY_FOR_CONFIRMATION",
  "source": { "type": "CSV", "filename": "user-export.csv" },
  "portfolio": {
    "as_of": "2026-10-09",
    "cash": 10000,
    "positions": []
  },
  "data_quality": {
    "valid_rows": 1,
    "invalid_rows": 0,
    "warnings": []
  }
}
```

后续与主项目融合时，Core Agent 只消费 `READY_FOR_CONFIRMATION` 之后的标准化结果；未知证券、缺失价格或用户未确认的数据不得进入健康检查。

## 本地检查

需要 Node.js 22 或更高版本，不需要安装第三方依赖：

```powershell
npm run check
```

## 演示网站

网站文件在 `site/`，打开 `site/index.html` 即可查看静态演示；部署后会通过 GitHub Pages 提供独立地址：

`https://realchenchenluo.github.io/agent/holdings-intake/`

网页中的 CSV 会在浏览器内解析，当前不上传文件。网站只展示导入、预览、校验和确认流程，不会把数据送进主产品。

