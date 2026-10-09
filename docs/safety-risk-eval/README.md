# 第四板块 Safety Risk Eval

第四板块负责接收有证据的方案与指标，按统一规则输出风险判断，验证用户确认，并规定风险审计与评测要求。

## 后续工作的固定约定

2026-10-09 用户转述队长任务并明确要求：Personal AI Fund Manager 应将真实金融数据、Research、Quant、Memory、Risk、Human Approval 串成可信、可解释、可审计的决策链。第四板块交付 Risk Engine、ALLOW／REVIEW／BLOCK／ERROR 四种结果及 Eval Cases，风险判断必须与团队统一数据格式。

- 后续开发前先核对团队最新公共 Contract；当前健康检查基线为 `investment-agent.v1`，入口在 `chenchen/contracts/`。
- 保留上游 `contract_version`、`request_id`、`task_id`、`session_id` 与证据 ID。Risk 按 `risk_handoff.evidence` 解析指定结果，不从页面文案或模型自由文本拼接审核事实。
- 上游 `risk_handoff.status = PENDING_REVIEW`、`decision = REQUIRED`、`execution_allowed = false` 表示交接。四种 Risk 结果应由独立风险输出承载，具体契约由架构负责人统一，不能直接改写健康检查协议中的常量。
- ALLOW 表示指定范围的风险检查通过；执行仍需要有效的 Human Approval 和执行前门槛。ERROR 表示未能可靠完成必要检查，必须停止相关执行。
- 数据字段名、类型、单位、符号、时间、版本和缺失值语义均需对齐；未提供的信息保留缺失，不补造为安全值。
- R01—R10 继续作为规则编号。四状态适配、规则结果格式及接口命名按下面的计划逐项评审，不把草案写成团队已经确认的事实。

## 当前入口

- [Risk 接口对齐与实施计划 v0.1](Risk接口对齐与实施计划-v0.1.md)：本轮仓库核对、字段差异、四状态提案、分阶段交付和评测清单。
- [权限风控规划表 v0.2](权限风控规划表-v0.2.md)：历史规划参考。
- [固定风险规则原型与架构 PR #4](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/4)：此前已推送的 R01—R10、固定案例页面和架构图。原型代码不等于正式 Risk Engine。

本目录是第四板块协作入口。真实数据供应、Quant 计算、Memory 存储及主流程路由由对应负责人提供；第四板块与他们共同完成接口和拦截边界验收。
