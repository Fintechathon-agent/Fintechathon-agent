# Risk interface adapters v1

第四板块接线提案：金额转换、四态到 Core 回调草稿、虚构样例及本地兼容测试。

完整字段表与边界：[接口字段对应与回调适配-v1.0](../../../docs/safety-risk-eval/接口字段对应与回调适配-v1.0.md)。

```powershell
node --test modules/safety-risk-eval/interface-adapters/test/*.test.cjs
node modules/safety-risk-eval/interface-adapters/write-examples.cjs --check
```

- `money.cjs`：人民币元/整数分精确转换，保留未知值，旧JSON数值往返校验。
- `risk-callback.cjs`：核对 Core 交接、规则结果和关联标识；生成严格10字段草稿，ERROR输出null。
- `fixture-data.cjs / write-examples.cjs`：生成可复现的四态结构样例，全部为虚构测试替身。
- `test/core-compat.test.cjs`：直接验证当前 Core 的校验器和工作流门禁，不联网。

所有草稿始终 `dispatch_allowed=false / execution_allowed=false`。本模块没有发送或签名函数，不是正式Risk服务，不改变原问答、审批或执行状态。读取最新可信任务、规则版本、签名身份、审计持久化和回调发送由下一步接线完成。
