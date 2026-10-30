# Core Agent + Memory P0 staging snapshot

Owner：陈全宝（林粹）  
候选来源：`realchenchenluo/agent`  
来源分支：`codex/core-memory-p0-20261030`  
来源候选 SHA：`6b69fa3a87b934644597ba8988bd3888a4c453aa`  
团队 staging 路径：`team-staging/core-agent/core-memory-p0-20261030/`
团队 PR：[Fintechathon-agent/Fintechathon-agent#39](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/39)（Draft，未合并）

这个目录是 Core Owner 的独立审查快照，供团队临时共创、联调和验收使用。它不会覆盖 `team-release`，也不修改其他 Owner 的目录。

## 内容

- `runtime/chenchen/core/`：Memory 和 Harness 的 Core 代码快照。
- `runtime/chenchen/tests/`：Memory P0 测试。
- `runtime/chenchen/contracts/examples/`：同意写入、撤回样例。
- `docs/`：接口、状态、阻断、回滚和验收说明。
- `evidence/logs/`：定向和全量测试日志。

## 状态

- 本地定向验证：31/31 通过。
- 本轮全量回归：418 tests，417 passed，1 skipped，0 failed。
- 模型、Risk、审批：合成替身；PAPER 模拟，无真实资金副作用。
- Risk 线上身份/签名：尚未完成双方真实部署核验。
- Vesper（潘心恬）同一候选 SHA 联合签认：待完成。
- 联合验收：`NO-GO`，前置条件满足后再改为 GO。

团队成员审查后请在群里回复候选 SHA、实际环境、测试命令、结果和未解决项；不要把 secret、API Key 或群聊隐私材料放进仓库。
