# Core Agent 执行保护补充交付 · 2026-10-19

本轮解决“批准了但拖到过期才执行”和“记忆保存慢、重复点击造成重复结果”两类问题，同时提供可审查的风控交接字段补丁。旧版本、失败日志和既有网页保留。全部新增测试使用虚构数据，外部模型与付费调用为 0。

## 已完成的核心接口

| 用户遇到的情况 | 本轮处理 |
| --- | --- |
| 已批准，但实际操作时批准已过期 | 模拟执行接口返回 409 / APPROVAL_EXPIRED；不占用演示资金、不写 Memory，任务与审计记为过期 |
| 记忆保存尚未返回，连续点十次 | 返回同一份模拟回执；一次资金占用、一次 Memory 请求，不生成第二份结果 |
| 已完成模拟，随后点取消 | 明确拒绝取消并保留操作记录；Memory 稍后返回时不会覆盖这条记录 |
| 记忆写入失败 | 保留已生成的模拟回执，Memory 单独记为 FAILED；不把已完成的操作改成未执行 |
| 旧的已完成任务超过批准期限 | 仍能查询和复用原回执，不把历史成功改写为过期 |

继续复用 `/api/review/simulate`、`/api/review/approval`、`/api/review/risk-decision` 和 `/api/review/task/{task_id}`。没有新增公共字段、状态或错误码，也没有延长既有 15 分钟批准期限。Risk 拒绝、等待审批或未接正式网关的阻断继续保留。

Core 只调整内部保存时机：先在共享工作流存储中保存模拟回执，再等待可选的 Memory 写入，写入返回后基于最新记录追加结果。授权条件、Memory 内容、同意标记和记忆规则保持原样。这里的提前保存是**当前进程内存中的保存，不是提前刷入云数据库**。

## 可验证的集成进度

| 验证层次 | 结果与证据 |
| --- | --- |
| 修复前复现 | 新增的 6 项共享工作流用例中 5 项失败、1 项通过；[原始失败日志](core-agent-execution-guards-before-2026-10-19.txt) |
| 修复后全部 Core 回归 | 220 项通过，失败/跳过均为 0；[完整 TXT](core-agent-execution-guards-tests-2026-10-19.txt)。比上轮新增 7 项：6 项工作流 + 1 项 Worker 请求/重载 |
| Worker 请求处理 | 同一任务批准后过期，模拟返回 409，重新创建服务后仍可查到 EXPIRED 与原审计；用本地存储适配器，未注入线上故障 |
| 当前 Core × 固定 Risk 源码 | 9 组检查通过、6 次合成模型响应；[请求/响应与审计证据](core-risk-execution-guards-integration-2026-10-19.json) |
| 运行版冻结接口检查 | **仍失败**：Handoff 多出 source_task_id；[错误证据](core-risk-execution-guards-blocker-2026-10-19.json) |
| 独立修复候选 | 原有联调记录中的 5 份成功提议通过冻结 Schema；[候选结果](core-risk-handoff-candidate-2026-10-19.json)，未接线上 |
| 语法与 Worker 构建 | 通过；[检查日志](core-agent-execution-guards-checks-2026-10-19.txt) |

Risk 源码固定在 ba5056621224f969eca75ce946403f8f70e95d23，未修改其规则。联调沿用 10 月 18 日的固定夹具日期，JSON 的 recorded_at / checked_at 为本轮 UTC 时间，不代表真实当日行情。状态仍为 LOCAL_CHECKS_PASSED_INTEGRATION_PENDING，不是正式联合验收。

Memory 并发缺陷在共享工作流及注入的慢写入器下复现。当前线上 Durable Object 串行处理请求且未注入真实 Memory 写入器，因此不能把该测试描述成“已修复线上真实 Memory 服务事故”。本轮也不承诺外部副作用或跨进程记忆写入 Exactly Once。

## 需要其他模块落实的事项

1. **Core/Backend 与 Risk：确认交接字段位置。** [候选补丁和复跑方法](../experiments/handoff-contract-candidate-v1/README.md)已经准备好。建议使用现有 reviewed_input 中的来源编号；旧记录缺少该对象时，需查询原工作流。若消费者必须保留顶层字段，应确认新的接口版本。没有双方确认前，不改线上导出。
2. **模型服务与 Risk：确认供应商回执编号缺失时怎样处理。** Core 允许 null，现有 Risk 消费者拒绝；不能填一个假编号冒充真实回执。
3. **Risk、Backend 与身份模块：提供正式接收地址、签名回写配置和可核验的审批身份。** 当前联调是来源关联的两个本地任务，尚不是同一任务的线上闭环。
4. **UI 与 Backend：接入最新 Core，并区分执行状态和记忆状态。** 已有回执而记忆仍 PENDING/FAILED 时显示相应状态，不重新发起一个资金任务；沿用稳定任务编号查询。
5. **模型与部署配置：实际百炼空间、受保护访问和测试预算仍需落实。** 用户未授权付费测试，本轮不做真实推理，不把 /health 的 configured 当模型验收。

本轮源码只修改 Core 的工作流文件，测试和材料在 chenchen/，团队联调入口在 team-staging/core-agent/execution-guards-v1/。其他 Owner 的源码、UI、公共 Schema 和 team-release/ 未修改。

## 上线与回退

本轮运行修复已发布到现有 Worker，版本 `92ecddff-6a19-463f-b87c-ea61680bc5f6`。公网 `/health` 和 `/docs` 均返回 200；[完整部署回执](core-agent-execution-guards-deployment-2026-10-19.json)记录源码提交、版本号与只读检查。未切换模型供应商、未开放真实交易；健康检查不等于真实模型、Risk 签名或联合验收。

上一版本 dcfe338e-4129-4644-b296-c6fe4cadac4a 保留，但回退会重新引入本轮修复的执行边界问题。如需回退，应暂停新增执行并核对待审批任务；更早版本还不识别持久登记，仍须遵守前一轮的未决任务核查要求。不得清空数据库或强制释放不确定记录。
