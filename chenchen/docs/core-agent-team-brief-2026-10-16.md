# Core Agent 团队简报 · 2026-10-16

## 一句话

Core Agent 现在已经能把“模型提出建议 → 统一 Risk → 必要审批 → 模拟执行 → 审计查询”串成一条可追踪主链路；真实交易仍保持关闭，正式 Risk 身份和安全网关还没有联合验收。

## 最近已经做好的东西

1. **模型服务已接通**：Cloudflare Workers AI 真实返回模型结果；模型最多重试一次，总预算受限，失败会留下失败记录，不能悄悄降级成成功。
2. **Risk Handoff 已固定**：模型输出只是提议，必须带着同一份 proposal hash、task、request、run、audit、handoff 证据交给 Risk。
3. **审批和模拟执行已串通**：Risk 通过后才进入必要审批；审批通过后只能做无副作用模拟，execution_allowed=false 始终保留。
4. **资金用途保护已接入演示链路**：虚构的房租预留、投资金额和计划 revision 会绑定到任务；用途变化或余额冲突会阻断模拟。
5. **取消保护已完成**：取消后的任务保持 CANCELLED，迟到的回调不会把它恢复；重复回调返回当前状态并保留审计。
6. **审批证据一致性已加强**：相同的人、相同的理由、相同的决定才会复用原记录；换人、换理由或改决定返回409，空白或超长理由返回422。
7. **错误接口统一**：新增 core-agent-error.v1。健康检查、模型复核、Risk 工作流错误都带统一的 request_id 和 trace，可定位 task_id / session_id / run_id / audit_id / handoff_id；旧字段继续保留，兼容旧页面。

## 当前能力状态

| 能力 | 当前状态 | 团队应如何理解 |
| --- | --- | --- |
| 模型调用 | **真实接通** | 公网后端实际调用 Workers AI，并保留模型响应 ID、调用次数和重试次数 |
| Core Agent 编排 | **演示覆盖且已验证** | 有状态、能停在 Risk/审批边界、能查询任务和审计 |
| Risk 回调 | **演示覆盖** | 回调字段和 hash 会校验，但 reviewer 仍是演示标签 |
| 审批 | **演示覆盖** | approver 仍是演示标签，尚未接正式权限系统 |
| 模拟执行 | **真实接通模拟链路** | 只产生模拟回执，side_effects=false，不触发交易或付款 |
| 正式 Risk / 审批 / 执行网关 | **尚未联合验收** | 不能对外说成生产交易能力 |
| Quant | **沿用现有结果** | Core Agent 不重新计算 Quant |
| Memory | **规则未改** | 本轮没有改变 consent、范围、生命周期和清理规则 |

## 本轮验证证据

- 本地 npm run check 通过；完整测试 **115/115 通过，0失败**。
- 本地重试故障注入和审批证据一致性脚本均通过。
- 公网版本：8394f4fc-6e73-4b20-a350-155a1fd5beeb。
- 公网使用虚构资金计划跑了两条路径、24个接口步骤：
  - 取消路径最终 CANCELLED，旧回调不能恢复；
  - 正常路径完成 Risk、审批和 SIMULATED；
  - 2次真实模型调用成功；7个预期错误响应均带 core-agent-error.v1 和完整 trace 字段；
  - 模拟回执 side_effects=false，真实执行仍为 false。
- 公网验证经过本机已有代理，不能据此宣称所有手机网络都能稳定直连。

## 团队联调时只看这几个入口

- 公网后端：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev
- 在线接口说明：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/docs
- 健康状态：https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health
- 网页工作台：https://realchenchenluo.github.io/agent/risk-workbench/?v=funding-20261015-1
- 统一错误 Contract：chenchen/contracts/core-agent-error.v1.schema.json
- 详细接口手册：chenchen/docs/core-agent-integration-guide-2026-10-15.md
- 本轮公网证据：chenchen/docs/public-error-contract-verification-2026-10-16.json

## 还需要其他 Owner 配合

- **Risk**：提供正式接收地址、服务身份/签名、回写样例和联合验收用例。
- **Approval**：提供受信任审批身份、权限范围和重复提交语义。
- **Backend**：确认生产多实例下的事务/串行保障和各网络环境可达性。
- **UI**：按统一错误 trace 展示“查看原记录 / 等待 Risk / 重新创建任务”，不要自动改理由重试。
- **Memory / Quant**：确认后续字段映射；本轮没有修改两方规则或计算。

## 对外表述边界

可以说：**Core Agent 已完成真实模型调用、统一 Risk Handoff、审批前置、模拟执行和审计链路演示，并有测试证据。**

暂时不能说：**已经接通正式 Risk、正式审批身份或真实交易执行。**

旧版本、旧日报、旧测试证据均保留；团队仓库只更新 chenchen/。
