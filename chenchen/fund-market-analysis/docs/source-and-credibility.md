# 市场雷达数据来源与可信度

## 当前数据状态

当前网站使用 `data/sample-market-context.json` 和 `data/source-registry.json` 组成的固定参考夹具，数据日期为 2026-10-08。网站前端没有实时请求行情或新闻接口，页面中的数值用于展示数据链路和冲突处理。

原始来源是用户提供的《每日市场简报_2026-10-08.pdf》。原始 PDF 没有上传到 GitHub，因此网站只能说明它是“用户提供的参考材料”，不能为它提供公开下载链接。

## 可查看的公开来源

| 数据项 | 公开查看入口 | 用途 | 当前限制 |
| --- | --- | --- | --- |
| 沪深300 | [中证指数有限公司](https://www.csindex.com.cn/) | 查看指数定义、代码和官方资料 | 页面历史涨跌值仍来自固定简报 |
| 创业板指 | [深圳证券交易所指数说明](https://www.szse.cn/disclosure/notice/general/t20100531_500454.html) | 查看指数代码和官方定义 | 页面历史涨跌值仍来自固定简报 |
| NYMEX WTI 原油 | [CME Group WTI Quotes](https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html) | 查看 WTI / NYMEX 行情入口 | 页面历史涨跌值仍来自固定简报 |
| 美国30年期国债 | [U.S. Treasury Daily Treasury Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?field_tdr_date_value_month=202610&type=daily_treasury_yield_curve) | 查看官方日度收益率曲线 | 页面历史值仍来自固定简报 |

## 可信度口径

这里的可信度是工程工作评级，不是统计学概率，也不是未来收益概率。它综合考虑：

1. 来源是否能公开追溯。
2. 数据是否实时或有明确数据日期。
3. 是否有第二来源交叉检查。
4. 样本是否足以支持当前结论。

当前整体评级为 **中低（2.5 / 5）**：可以用于比赛演示、数据链路检查和观察项讨论，不可以作为直接投资依据。

单条市场观察的可信度为：

- 沪深300、创业板指、NYMEX原油：中低（2.5 / 5）。有公开官方查看入口，但页面历史值仍来自固定简报，没有实时复核。
- 美国30年期国债：中（3 / 5）。有官方财政部数据入口，但当前页面仍没有自动拉取并逐日比对。

分析信号的可信度更低：

- “成长资产对利率更敏感”：低（2 / 5），只是少量数据的并列观察，不能证明因果或预测收益。
- “原油价格与消息解释待复核”：低（1.5 / 5），价格与消息的独立来源还没有在系统内逐条绑定。

因此，页面会把数据可信度和结论可信度分开标注；出现 `REVIEW_REQUIRED` 时，不会自动生成买卖建议。
