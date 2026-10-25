# 百炼 qwen3.8-flash 接入准备（2026-10-25）

状态：**仅源码和替身测试通过；未设置新密钥，未发起百炼请求，未部署此分支。** 截图中的旧密钥已经暴露，必须在百炼控制台撤销；新密钥只写 Cloudflare Worker Secret，不进入仓库、聊天或命令参数。账户余额、业务空间权限、实际账单和收费测试预算仍待账户持有人核实。

阿里云[模型说明](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)明确模型调用 ID 为 `qwen3.8-flash`，北京支持结构化输出与工具调用。本适配只使用 Chat Completions 的非流式 JSON 输出；这些能力的真实账户可用性尚未验证。北京[官方目录价](https://help.aliyun.com/zh/model-studio/model-pricing)为每百万输入 Token 0.8 元、输出 Token 2.7 元；优惠、免费额度与最终账单必须以账户为准。保留 `qwen3.7-flash` 及已核实日期快照作为代码回退选项，其北京短输入目录价更低，预算预估仍采用 3.8 的较高价格。

## 安全配置

1. 在北京业务空间确认实际 Workspace ID、模型授权与新 Key。配置示例为 `chenchen/wrangler.bailian.example.toml`，其中 Workspace ID 留空、付费开关为 `false`、预算均为 `0`。
2. 专属兼容端点由服务端按 Workspace ID 组成：`https://<workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`。不得把截图里的旧 Key 或完整专属地址硬编码。
3. 在账户持有人明确批准收费测试后，才分别配置 `BAILIAN_TEST_BUDGET_CNY` 与 `BAILIAN_DAILY_BUDGET_CNY`，然后开启 `BAILIAN_ALLOW_PAID_CALLS`。每日额度必须大于 0 且不超过总额度；当前批准金额仍为 0。
4. 在服务端交互式设置 `DASHSCOPE_API_KEY` Secret。运行 `node chenchen/scripts/bailian-preflight.js` 只检查本地配置，不联网、不开启推理。

## 预算与记录

`bailian-budget:v1` 原键保留。旧记录的 `reserved_cents` 作为历史占用迁移到新账本的 `spent_micros`；新的持有和结算分别写 `held_micros`、`spent_micros`，北京时间每日额度另行追踪。每次请求在 HTTP 前按输入 UTF-8 字节、协议余量及 `max_tokens` 预留，最少 0.01 元；成功且收到完整 token 用量后按目录价估算结算。失败、超时或用量不全保留全部预留额。并发预留在 Durable Object 内串行；重试分别占用预算；上游调用编号、用量、耗时和失败状态保存在原尝试记录中。

这些数额是**内部守卫估算**，不是阿里云账单或上游硬性消费封顶。价格变化、隐藏计费项或提供商用量差异仍需通过实际账单对账；未知账单不得标为零元。内部预算不足返回 `DAILY_BUDGET_EXHAUSTED`，并附总额或每日范围；请求频率限制返回 `RATE_LIMITED`。上游鉴权、限流和超时沿用独立模型错误，不能靠更换 Key 清除内部账本。

## 本地验证

- `node --test chenchen/tests/bailian.test.mjs chenchen/tests/bailian-worker.test.mjs`：16/16 通过，供应商 HTTP 全部替身。
- `npm.cmd run check --prefix chenchen`：通过。
- `npm.cmd test --prefix chenchen`：287/287 通过。

真实账户、非流式回答、流式回答、工具调用、Risk 联调和 staging 扣费对账均未在本轮完成；本分支不得据此切换生产模型。
