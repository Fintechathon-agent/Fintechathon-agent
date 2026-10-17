# Finance Lab · 正式交付范围

- 来源仓库：`jinyihan77-create/personal-ai-fund-manager`
- 来源分支：`master`
- 来源提交：`1d97ac237127e5713019bede57ef0662aba5beb2`
- 正式目录：`team-release/finance-lab/`
- 实际源代码：[`qiqi/`](../../qiqi/)

## 已交付范围

1. 六场景自然语言入口、意图/槽位与场景 DAG。
2. 绿/黄/红/阻断权限、确认与取消、审批生命周期和审计回执。
3. 余额、日累计、预约、卡状态、纸交易回执的持久化与失败回滚保护。
4. 模型 demo/live 状态透明、DeepSeek/OpenAI-compatible 配置说明。
5. 154 项自动化测试、隔离安全评测和可追溯审计证据。

## 验证记录

- 单元/集成：154 项通过。
- 安全样本：54/54 攻击拦截，0/20 正常表达误伤；该数字只适用于固定样本。
- 语法检查：Python `compileall` 与 JavaScript `node --check` 通过。
- 浏览器证据：已有主工作台、v2、compare 的 1440px/390px 记录；本轮机器缺 Playwright，未重新执行，不能标成“本轮浏览器验收通过”。

## 回滚与边界

回滚到来源提交 `1d97ac237127e5713019bede57ef0662aba5beb2` 之前的 `qiqi/` 版本即可。强验证、外部银行、短信、人脸、商户下单、真实模型 Key、公网后端和文档封版仍需团队确认；当前是本地演示/模拟能力，不能宣称真实资金交易或完整产品上线。