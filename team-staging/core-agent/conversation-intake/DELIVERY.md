# Core Agent 待确认清单 · 临时共创交付

- 维护账号：`realchenchenluo`。
- 阶段：本地实现与测试，待相关模块确认；不属于正式交付区。
- 源码：[`chenchen/experiments/conversation-intake`](../../../chenchen/experiments/conversation-intake/README.md)。
- 来源：团队 `main` 基线 `d4277265aa10ab5d56de3b27351c0f6413085506` 上的新增试验；本次提交编号可在 GitHub 本目录历史查看。
- 目的：把混合描述整理为可追溯的候选条目，缺失信息明确提问，方便 UI / Memory / Risk 联调。

## 一起试用

从仓库根目录运行：

```sh
node team-staging/core-agent/conversation-intake/run-demo.js
node --test chenchen/tests/conversation-intake.test.js
```

需要 Node.js 22+，不需要密钥或第三方依赖。演示输入为虚构数据；输出写到终端，不联网、不保存真实用户资料。只下载本文件夹无法运行，需要同一提交的 `chenchen/experiments/conversation-intake/` 和模型输入定义。

## 变更边界

共创入口复用个人目录中的维护版本，不复制整套后端。不改 UI、不改 Memory 规则、不重新计算 Quant、不改已有 Risk 状态或接口字段。本草稿没有注册成公网接口，也不会自动提交资金任务。

## 验证及待确认

测试覆盖混合语句、原文定位、千分位金额、相对日期、否定/他人描述、缺失报价、恶意指令、超限输入及现有请求格式兼容。

完整结果见 [2026-10-17 迭代记录](../../../chenchen/docs/core-agent-iteration-2026-10-17.md) 和其链接的测试记录。

待 UI 确认交互，待 Memory 确认授权和来源验证，待 Risk 确认可信上下文接收方式。只有待提交请求，没有用户确认系统、Memory 入库或真实比价工具。相关 Owner 尚未联合验收，因此不复制到 `team-release/`。

## 版本与回退

旧产品、旧目录和历史提交保留。这个试验是新增目录，可暂停使用入口；无需覆盖旧产品。线上后端修复与本试验隔离，详见迭代记录。不得上传群聊、身份资料、密钥或未经授权的真实金融资料。
