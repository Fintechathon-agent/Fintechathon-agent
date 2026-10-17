# 百炼开通与安全配置指引

当前进度：后端适配和本地模拟测试已准备；尚未开通百炼、尚未创建密钥、未调用百炼。付费开关关闭、测试预算为 0，现有线上模型继续服务。

## 你现在只需要做这些

1. 打开 [百炼控制台](https://bailian.console.aliyun.com/)，用自己的阿里云账号登录。没有账号先注册；实名验证、验证码和协议确认由本人完成。按页面提示开通百炼，当前先不购买套餐、不运行模型体验。
2. 选择 **华北2（北京）**，进入 [全局管理 / 业务空间](https://bailian.console.aliyun.com/cn-beijing?tab=globalset)，创建独立空间，例如 `finance-lab-test`。这是显示名称，和后面的业务空间 ID 不一样。找不到创建入口时，检查是否使用主账号或有相应管理权限。
3. 在该空间的模型管理里核对并授权 `qwen3.7-flash`；查看它的服务部署范围及模型说明，不要直接开始对话测试。
4. 打开 [北京 API Key 管理](https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key)，创建归属于这个比赛空间的专用 Key。权限按实际模型需要设置。密钥不要发聊天、群聊、截图或 GitHub。
5. 从空间详情记录 **Workspace ID / API Host**。可以告诉开发者“空间已建好、Key 已创建”，再通过服务端的密钥设置页面完成配置。

操作依据：[首次调用官方指引](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)、[API Key 官方指引](https://help.aliyun.com/zh/model-studio/get-api-key)、[业务空间权限说明](https://help.aliyun.com/zh/model-studio/permission-management-overview)。菜单可能随控制台更新，以当前页面为准。

## 密钥应该放在哪里

当前项目后端运行在 Cloudflare Workers。以后准备接通时，在 Cloudflare 控制台找到 `personal-ai-fund-manager-core-agent`，在变量与密钥设置中新增加密 Secret：

- `DASHSCOPE_API_KEY`：阿里云专用模型密钥。
- `CORE_AGENT_API_KEY`：团队后端调用 Core Agent 的独立凭证，不是阿里云密钥。不要把它作为浏览器前端的共享常量；网页正式访问仍需身份系统或可信后端代理。

当前不用开启付费开关，也不用切换线上模型。仅设置密钥不等于完成真实接通；后续需配置 Workspace ID、确认测试预算、完成验收后才能切换。

开发者也可使用 `npx wrangler secret put DASHSCOPE_API_KEY --config wrangler.toml` 的交互输入。不要把密钥写在命令参数、代码、配置示例或部署说明里。

## 接入地域与数据位置

项目按北京业务空间专属域名准备：`https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`。不同地域的 Key、模型和域名不可混用。

官方区分“接入地域”和“推理服务部署范围”；北京新模型可能采用中国弹性区。不能只凭北京域名声称推理全程在中国内地。模型别名后续也可能变化，若比赛有严格要求，应核实实际模型版本和部署范围。[官方地域说明](https://help.aliyun.com/zh/model-studio/beijing-access-information)

此外，现有 Core Agent 与审计记录在 Cloudflare，整个项目尚不是经过验证的中国内地全链路部署。本轮继续只使用虚构数据；切模型本身不会迁移后端和日志。

## 开通后下一步

配置完成后，先验证一条不含隐私的输入，再逐项验证账户数据、工具结果、风控拒绝、超时与并发。真实模型测试须在明确同意费用后进行。本轮不充值、不购买、不发送百炼推理请求。
