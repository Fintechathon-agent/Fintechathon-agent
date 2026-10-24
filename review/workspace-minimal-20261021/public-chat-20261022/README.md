# 独立分享页免口令对话 · 2026-10-22

用户明确要求取消邀请码并在原位置直接显示对话栏。本轮只更新独立 `xinlan-qwen38-share`，新增显式PUBLIC访问模式；团队核心、审批、执行、共享模型契约和main保持原状。独立部署授权与边界记录见 `docs/contract-proposals/2026-10-22-independent-public-chat.md`。

## 页面行为

- 打开AI面板即显示问题输入框，不再要求填写分享访问口令。
- 自动取得或复用签名会话，提交前自动确认会话；初始化连接失败后可在下一次发送时重连，不自动重试模型。
- 输入框置顶，下方保留原有必要投资信息与发送确认，不编造或预填用户投资偏好。
- CODE模式作为回退保留；PUBLIC模式隐藏登录与退出控件。

## 服务边界

- Cookie保持HttpOnly、Secure、SameSite=Strict；跨站会话初始化、缺少签名配置、伪造凭证及工作流写入仍拒绝。
- 所有自动会话继续使用原共享subject，因此刷新、重开或清除Cookie均不重置每日额度与持久化总预算。
- 每分钟2次、每日最多20次、已有0.20元保守预留总预算及模型单次尝试均保留，不提高预算或重传Secrets。
- 本次部署仅将 `SHARE_ACCESS_MODE` 设为PUBLIC，其他生产变量通过 `--keep-vars` 保留；源码默认CODE。

## 验证

- 网关与会话24项检查通过，覆盖旧CODE路径、自动会话、签名校验、跨站拒绝、相同subject与频率限制。
- PUBLIC浏览器Mock覆盖375/840/1440px，验证直接输入、必要字段校验、单次发送、答复显示、401/429、连接失败后重连；口令POST为0，真实付费调用为0。见 `browser-mock.json` 与 `mock-*.png`。
- 既有慢登录初始化检查通过；原浏览器Mock三种宽度、三方案和七种失败情况全部通过。
- 编译和发布通过，Worker版本为 `0807ac09-1038-4b85-9b3c-1752ced1faef`；健康状态为PUBLIC、configured=true、paidEnabled=true。部署记录见 `deployment.json`。
- 全新浏览器会话在375/840/1440px线上均直接显示输入框，自动会话成功，口令POST为0，4个发布文件字节与候选一致，无脚本异常或横向溢出。
- 在已有0.20元预算内发送1次虚构验收请求，网页到Worker再到 `qwen3.8-flash` 返回HTTP200，耗时8368ms、1171tokens；答复与供应商原文逐项一致，execution_allowed=false。保守预留从4分变为5分，未提高总额度。见 `live.json`、`live-reply.png` 和 `online-*.png`。

## 复验

使用已准备的隔离候选执行测试，默认不产生真实模型请求。以下命令在独立模块目录内执行。

```powershell
node --test tests/share.test.mjs tests/gateway.test.mjs
node tests/browser-public.cjs --evidence=<evidence-directory>
node tests/public-cloud-acceptance.cjs --evidence=<evidence-directory>
```

真实验收需另行显式添加 `--one-live-call`；脚本先检查原预算余量，发送前持久化尝试记录，并拒绝自动重复已经记录的付费调用。本轮真实验收已经完成，不应重复运行。

验收入口：[直接对话](https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment?v=20261022-public-chat#ai-assistant)。
