# 候选提案：用户自述需求与 Qwen3.8 显式模型配置

状态：本轮用户要求的候选实现与本机真实验收已准备；等待后端/Contract Owner 审核后发布。没有修改团队根目录后端、共享枚举、审批逻辑、Risk 或持久审计 Schema。

- 沿用已有 `model-review.v1` / `review-workflow.v1` 六字段模型输出。金额、风险偏好、目标放入现有 `text`，不增加公共必填字段。用户自述使用已有 `LIVE` 枚举、`context.synthetic=false`；虚构输入仍为 `SYNTHETIC_REPLAY`、`true`。两者只描述输入来源，均不代表有实时行情，`market_data_available=false`。缺失回撤值不从风险偏好推算，允许在该候选中省略。
- 浏览器仍须 Access 签名验证，服务端重建请求并注入 Core 凭据。禁止用户指定任务归属、权限、执行动作；`PAPER`、`REVIEW_ONLY`、禁止规则回退、执行关闭和原串行队列保持。
- 在现有 summary/action_reason 中返回五方面教育分析，不新增输出字段、不自动分配资金、不生成实时行情、收益承诺或个股买卖指令。新增原文一致性校验与完整原文查看。
- 默认 Flash。浏览器入口仅接受 `qwen3.8-flash` 或 `qwen3.8-max`，由服务端 MODEL_NAME 显式选择，不自动切换；模型身份必须匹配。旧 3.7 仅为原机器调用保留，不参与听澜自动回退。
- prepare.cjs 在隔离副本增加 Max 白名单与身份校验，并将每次 Max 预留改为 50 分（Flash 保持 1 分），继续使用原持久预算字段。依据 24000 字节请求上限、1600 输出 tokens 以及本轮核查的北京 Max 价格，预留高于估算；仍不是供应商账单硬封顶。不得用 Flash 的 0.01 元授权调用 Max。Max 只有 Mock 验证，未付费实测。

Owner 确认项：用户自述财务需求的处理范围、审计记录保留策略、Access 账号/域名、可选回撤值、五方面输出用途及 Max 预算预留。审核完成前不能把隔离补丁并入正式后端或部署替换现有 Worker；不合并 main / team-release。
