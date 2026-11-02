# China Network 供应商对接清单

日期：2026-10-29。状态：仅准备资料，尚未购买、提交销售表单或开通服务。

## 可复制给销售的项目说明

我们准备提交一个金融 AI 比赛演示作品。系统包含静态页面、Node HTTPS API、Cookie 会话、SSE 流式回答、签名只读风控和持久化记录。使用合成数据，不接真实支付，不执行真实买卖。目标是中国大陆评委无需代理，能够完成网页和 API 的整段演示。

我们正在并行准备国内 Node 服务器作为源站，希望 China Network 提供一个独立域名入口。请先书面确认所需条件、价格和预期时间，再签约。

## 必须获得的答复

| 项目 | 当前状态 | 需要供应商确认 |
| --- | --- | --- |
| Enterprise + China Network | 未开通 | 套餐报价、合同期、最低消费、是否有试用/PoC；不假设免费 |
| 购买主体 | 未确定 | 学生团队/个人主体能否签约、需要哪些资料 |
| 域名和 ICP | 尚无资源 | 可接受的备案主体、域名资质、内容审核条件 |
| 国内 HTTPS 回源 | 尚无源站 | 源站 Host/SNI、证书要求、DNS 和回源 IP/连接策略 |
| 动态 API | 未联调 | POST 和 Cookie 不被缓存、不改请求体和签名；是否需 Global Acceleration |
| SSE | 未联调 | text/event-stream、禁缓存、禁缓冲、连接时限能否覆盖 180 秒 |
| Workers / Assets / Secrets / Service bindings | 文档列出部分支持 | 当前合同实际提供哪些能力、限制和区域 |
| Durable Objects | 文档未明确列出 | 是否支持现有 SQLite DO，数据存放/迁移与一致性如何；未确认前不走直接迁移 |
| API 可达性验收 | 未运行 | 提供中国移动、电信、联通的 PoC 或验收方式 |
| 上线日期 | 未承诺 | 2026-11-02 前是否现实可达；要拆分签约、备案、审核与域名接入时间 |

## 官方依据

- [开通流程](https://developers.cloudflare.com/china-network/get-started/)：要求 Enterprise 和独立 China Network 订阅、ICP、京东云内容审核。文档的 24–48 小时仅指审核通过后的首次域名接入，不是从付款起的完整周期。
- [功能列表](https://developers.cloudflare.com/china-network/reference/available-products/)：列出 Workers、Assets、Secrets、Service bindings 等；没有明确承诺本项目的 Durable Objects 或 SSE 配置已兼容。须用实际架构逐项确认。
- [FAQ](https://developers.cloudflare.com/china-network/faq/)：PoC 同样要求有效 ICP 与内容审核；不能认为先试用就能绕过这些条件。

没有企业报价前不填预计总价；没有审批通过前不宣称可赶上比赛。账户管理员通过 Cloudflare 官方渠道办理，不在 GitHub 保存合同、个人身份材料、邮箱或付款资料。
