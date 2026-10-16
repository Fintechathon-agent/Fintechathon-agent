# Core Agent 会议要求落地记录 · 2026-10-16

## 本轮落实

- 沿用现有 Core Agent 公网后端和 `model-review.v1`，没有新建第二套主链路。
- 增加 `MODEL_PROVIDER=deepseek` 配置。DeepSeek 使用 OpenAI 兼容的 Chat Completions 接口，默认地址为 `https://api.deepseek.com/chat/completions`；密钥仍只放部署环境。
- 增加统一场景标记：
  - `GENERAL_REVIEW`：普通复核
  - `FUNDING_CONFLICT`：投资计划和生活开支冲突检查
  - `DOUBLE11_COMPARE`：双十一优惠/比价场景
  - `SUBSCRIPTION_REVIEW`：订阅管理场景
- 增加 `agent-output.v1` 输出约定。Core Agent 直接提供 JSON；PDF、PPTX、DOCX、XLSX 和图形请求会标记为 `PENDING_CONVERTER`，等待统一转换模块，不把未生成的文件当成成功。
- 场景标记和输出约定会跟随模型结果、任务记录和 Risk Handoff，便于 UI、Risk 和转换模块使用同一份任务信息。

## 保持不变

- UI 本轮未修改，等待核心逻辑稳定后再迭代。
- Core Agent 不重新计算 Quant，不修改 Memory 规则，不绕过 Risk。
- `execution_mode` 仍为 `PAPER`，`execution_allowed` 仍为 `false`。
- 正式 Risk、正式身份审批和真实执行网关仍需对应 Owner 提供地址、认证和联合验收样例。

## 交接给团队

- 李想（小果）：消费 `scenario` 和 `output_contract`，页面显示“场景”和“格式转换待接入”，不要显示未生成的文件。
- 潘心恬（Numinous、Vesper）：Risk Handoff 可直接读取 `scenario`，继续只根据证据和统一任务编号判断，不把场景标记当成授权。
- 邹昕成（队长）：确认四个场景名称和 `agent-output.v1` 是否作为公共接口锁定。
- 其他 Owner：提供真实服务地址、测试方式和返回样例后，再进行跨 Owner 联合验收。

## 运行边界

本轮只做接口层和状态层准备。没有接入真实优惠券抓取、跨平台价格比较、订阅扣款或真实交易，也没有把群聊原文、原始 PDF 或真实账户资料上传到仓库。
