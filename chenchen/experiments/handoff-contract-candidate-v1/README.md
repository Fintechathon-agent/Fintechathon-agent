# Risk 交接字段修复候选 v1

状态：**候选验证通过，尚未应用**。正式运行代码的严格接口检查仍失败，不可据此宣布联调验收完成。

## 建议负责人确认的选择

当前运行代码在 Handoff 顶层增加了 `source_task_id`，冻结的 `risk-handoff.v1` 不允许这个字段。本候选仅删除交接包中的这一处重复导出，不改 Schema。新记录的来源编号仍在 `reviewed_input.source_task_id`；原工作流及 `GET /api/review/task/{task_id}` 仍保留顶层来源编号。模型提议、任务编号、审批、回调绑定及执行阻断不变。

需要 Core/Backend 与 Risk 确认：所有消费者是否可以使用上述位置，是否有人依赖旧 Handoff 顶层字段。如果必须继续使用顶层字段，应另行决定接口升级，不能静默放宽冻结 Schema。没有获得双方确认前，不应用本目录补丁，不将候选挂到线上路由。

旧记录可能没有 `reviewed_input`。本候选保留 null，不伪造来源。此类记录要通过原工作流查询来源，或者由双方选择另一版本方案；不能声称旧消费者无须调整。供应商回执编号为空时的消费者拒绝问题也没有由本补丁解决。

## 可直接审查的内容

- [一行运行代码补丁](remove-undeclared-alias.patch)：只作用于 chenchen/integrations/risk-handoff.js。
- [验证器](verify.mjs)：`git apply --check` 只检查补丁可应用性，再在内存中运行补丁后的模块；不改工作区，不注册新接口。
- [本轮证据](../../docs/core-risk-handoff-candidate-2026-10-19.json)：使用前一轮本地联调保存的 5 份成功提议，重新做严格格式检查；不是新调用模型。

验证覆盖：原导出确实失败；候选逐条通过现有 AJV 格式检查；只删指定字段；来源工作流未改变；未知字段与允许执行标志被拒绝；回调 6 个编号/哈希分别篡改都被拒绝；旧输入缺失不伪造。回调检查直接调用既有校验函数，没有向真实 Risk 发请求。

## 复跑

先按 [源码联调准备说明](../owner-integration-v1/README.md) 获取固定 Risk 快照和锁文件依赖，在 chenchen 目录执行：

```powershell
node experiments/handoff-contract-candidate-v1/verify.mjs --snapshot <准备好的快照目录> --evidence docs/core-risk-local-integration-2026-10-19.json --output <新的证据文件.json>
```

输出文件必须不存在，避免覆盖历史。退出码 0 只代表候选验证通过；报告同时保留 `live_contract_status=BLOCKED_SOURCE_TASK_ID_UNDECLARED`。正式冻结接口检查仍用原 `owner-integration-v1/check-contract.mjs`，不要用候选结果替换它。

本目录用于临时共创审核。没有改 Risk Owner 源码、Memory 规则或公共 Schema；没有真实模型、正式审批身份或资金执行验收。
