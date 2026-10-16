# 国内模型与蒸馏研究记录 · 2026-10-16

## 会议要求对应

会议提出优先考虑国内模型，并研究大模型“逆向工程与蒸馏”。本记录把它转成可以用于比赛的安全开发计划：研究模型表现和公开方法，不提取闭源模型内部数据，也不把未经授权的群聊、账单或 PDF 原文作为训练数据。

## 国内模型接入结论

Core Agent 已增加 `MODEL_PROVIDER=deepseek` 配置，沿用现有 `model-review.v1`、Risk Handoff、审批和执行阻断。DeepSeek 的 Chat Completions 接口支持 `response_format={"type":"json_object"}`，适合继续使用当前的 JSON 结果校验流程。

推荐配置：

```text
MODEL_PROVIDER=deepseek
MODEL_API_KEY=<部署环境 Secret>
MODEL_NAME=deepseek-chat
MODEL_API_STYLE=chat_completions
MODEL_RESPONSE_FORMAT=json_object
MODEL_API_URL=https://api.deepseek.com/chat/completions
MODEL_FALLBACK_TO_RULES=false
MODEL_DISABLE_RULE_FALLBACK=true
```

官方资料：

- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [DeepSeek API 调用示例](https://api-docs.deepseek.com/guides/codex)

当前公网演示仍使用已验证的 Workers AI。切换 DeepSeek 需要在部署环境添加密钥并做真实调用验收，不能只修改页面文字就宣称已经接通。

## 蒸馏研究的可执行方案

1. 先建立少量人工确认的 Golden Set，覆盖资金用途冲突、双十一比价、订阅管理、信息缺失、外部文本诱导和 Risk 拒绝等情况。
2. 使用允许使用的教师模型生成结构化结果，只保留场景、摘要、风险等级、建议动作、缺失信息和证据，不保存不必要的原始内容。
3. 由潘心恬（Numinous、Vesper）确认风险标签和拦截结论，错误样例进入反例集。
4. 训练或微调学生模型前，先比较教师模型、学生模型和固定规则在同一批测试数据上的结果。
5. 验收指标至少包括：场景识别准确性、资金冲突漏报率、Risk 拒绝是否被保留、JSON 格式成功率、模型失败时是否阻断。
6. 学生模型上线后仍只能提出建议，不能替代 Risk、审批或执行网关。

相关公开研究：

- [Knowledge Distillation: A Survey](https://arxiv.org/abs/2006.05525)
- [Teacher-Student Architecture for Knowledge Distillation: A Survey](https://arxiv.org/abs/2308.04268)
- [DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning](https://arxiv.org/abs/2501.12948)

## 当前没有宣称完成的内容

- 没有训练新的学生模型。
- 没有接入真实 DeepSeek 密钥到公网环境。
- 没有进行闭源模型内部提取或系统提示词复制。
- 没有把群聊原文、真实账户资料或原始金融 PDF 上传到 GitHub。
- 没有改变 Quant 计算、Memory 规则、Risk 边界或真实执行权限。
