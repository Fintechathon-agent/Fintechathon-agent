# GitHub 调研记录

## 调研结论

本项目只吸收公开项目中可借鉴的产品结构和数据边界，不复制代码、页面或品牌表达。

### 持仓导入方向

- [kingsleychenlab/RiskEngine](https://github.com/kingsleychenlab/RiskEngine)：采用 CSV 上传、逐行校验、持仓预览、风险分析和导出。可借鉴“先校验再分析”的流程。
- [Yashsavgupta/Portfolio-Analysis](https://github.com/Yashsavgupta/Portfolio-Analysis)：覆盖多个券商导出格式和基金持仓文件。可借鉴“来源适配器”思路，但不能直接假设所有券商格式一致。
- [Rbh2733/Dashboard](https://github.com/Rbh2733/Dashboard)：同时提供手动录入和 CSV 上传。可借鉴新用户的双入口设计。

### 市场分析方向

- [ksd-labs/mf-analytics](https://github.com/ksd-labs/mf-analytics)：包含基金分类、基准、因子、市场状态和不确定性分析。可借鉴“分类比较 + 因子解释 + 限制说明”的结构。
- [shalini-k-git/mutual-funds-market-analysis-powerbi](https://github.com/shalini-k-git/mutual-funds-market-analysis-powerbi)：围绕 AUM、申购赎回和基金类别进行市场级分析。可借鉴“资金流和类别变化”作为后续数据层。
- [eeshsaxena/smart-money-tracker](https://github.com/eeshsaxena/smart-money-tracker)：研究基金经理持仓变化、风格和行业集中度。可作为未来“市场结构观察”方向，不直接转成用户交易建议。

## 与当前主项目的关系

这两个实验项目暂时不导入当前 `chenchen` 主应用，不修改 Core Agent 的实现，也不改变 Quant、Memory、Risk 和 UI 的职责。未来融合时必须先确定版本化输入输出、数据日期、来源可信度和失败状态。

