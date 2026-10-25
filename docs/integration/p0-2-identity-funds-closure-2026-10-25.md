# P0-2 身份、审批与资金边界复核（2026-10-25）

## 结论

**本机访客沙箱的隔离与转账/投资共用现金已验收；团队线上跨 Finance、Risk、Core 的可信用户审批和同一资金账本未闭环。** 当前本机入口禁用远程 Core review 和真实模型，Core 执行网关仍关闭，因此本轮未发现这两项缺口已造成真实交易放行。不能以本机通过或服务 HMAC 签名宣称线上最终用户认证完成。

## 逐环节结果

| 环节 | 实际状态与证据 | 闭环判定 |
| --- | --- | --- |
| 浏览器 → Finance 访客身份 | `qiqi/web/guest_gateway.py` 签发 24 小时签名 Cookie；`guest_worker.py` 按访客及模式分进程/目录，拒绝客户端自填身份及直接访问私有 Worker。`tests.test_guest_accounts` 12/12 通过，包含跨访客读取/审批拒绝、Cookie 篡改、模式隔离、跨站请求。身份仅是匿名浏览器会话，不是实名或跨设备账户。 | 本机演示已闭环；团队账户未闭环 |
| Finance 转账 → 投资现金 | `qiqi/web/unified_account.py` 用同一原子账本处理转账、投资成交、现金约束、回执和幂等；12 项测试包含并发争用、磁盘故障回滚及重启恢复。该账本只属于一个访客进程。 | 本机演示已闭环；托管账户迁移未闭环 |
| Finance → Risk → Core | 当前源码的三服务 HTTP 复跑 6/6，通过机器鉴权、伪身份阻断、用途资金冲突、同任务回调及重放检查；模型调用 2 次均为替身，真实调用 0。测试使用 Core 存储和批准身份替身，不是用户实际会话。 | 本机替身链路通过；线上未闭环 |
| Core 审批身份 | `owner-bridge.js` 的 HMAC 验证只证明审批服务持有密钥；`approver` 仍是服务签名正文中的人员标签，没有最终用户登录/强验证的证据绑定。原能力接口把“配置了审批服务密钥”直接映射为 `trusted_identity_ready: true`，本轮已修为分别报告 `service_signature_ready` 与恒为 false 的 `end_user_identity_ready`/`trusted_identity_ready`，并加回归测试。 | 状态误报已修；最终用户认证未闭环 |
| Core 资金预留 ↔ Finance 账本 | `chenchen/integrations/funding-plan.js` 使用独立 `funding-demo` 计划及占用列表，创建时接收自述 `cash_minor`，没有 Finance 账户 ID、账本版本或原子扣减接口；`guest_worker.py` 则禁止远程 Core review。两个局部资金检查目前不能共同证明跨服务不重复占用。本轮 Core 能力接口新增 `funding.account_binding_ready: false` 与 `shared_cash_ledger_ready: false`，避免误读。 | 未闭环，当前由访客入口阻断远程执行 |

## 未闭环位置及所需输入

1. **主聊天身份入口（理想 / 七七）：**提供当前公开主聊天对应源码、部署 SHA、staging 入口及可信登录主体的服务端标识。需要定义同一 `subject_id`、账户 ID、模式和任务 ID 如何由主聊天签发并传到 Finance/Risk/Core；浏览器正文不能自行声明这些字段。
2. **用户审批服务（理想 / 林粹）：**提供审批服务源码及其验证最终用户的机制。审批回调须绑定已认证用户、任务、提议哈希、批准动作、时间与验证方式；Core 必须验证同一主体和计划版本。仅有 `X-Approval-Signature`、`approver` 字符串或演示短信/人脸布尔值不达标。
3. **统一账户与资金预留（七七 / 林粹 / Vesper）：**确定唯一资金账本和账户版本；让 Core/Risk 在计划、批准、执行前读取同一可用现金和已占用金额，在写入边界原子预留/扣减，并将回执回写同一任务。现有 `funding-demo` 计划不能直接充当 Finance 账本。
4. **团队 staging 联合验收（各 Owner）：**以同一部署 SHA、同一可信用户与账户，跑未批准、跨用户批准、改参、偏好变更、转账与投资并发抢占、执行失败、重放、服务超时和重启恢复。检查无第二次扣款、无假成功回执，并保存任务/账本/审计关联证据。

以上 1—3 缺少的团队源码、身份提供方和 staging 配置不在当前可见仓库中。本轮没有自行开放被禁用的远程执行入口，也没有把替身身份写成真实用户认证。

## 本轮复核

```powershell
npm.cmd test --prefix chenchen
# 318/318，含 Core 完整回归和本轮新增身份状态断言

node --test chenchen/tests/risk-auth-readiness.test.mjs chenchen/tests/owner-bridge.test.js chenchen/tests/review-capability-guards.test.js
# 32/32，包含新增的“审批服务签名不等于最终用户身份”用例

Push-Location qiqi
$testTmp = (New-Item -ItemType Directory -Force -Path '.test-tmp').FullName
$env:TEMP = $testTmp
$env:TMP = $testTmp
.\.venv\Scripts\python.exe -m unittest tests.test_guest_accounts -q
Pop-Location
# 12/12，本机回环 HTTP、虚构账本

$env:PYTHON_EXECUTABLE = (Resolve-Path 'qiqi/.venv/Scripts/python.exe').Path
node modules/safety-risk-eval/joint-acceptance/verify-current-http.cjs --out qiqi/.test-tmp/p0-2-report.json
# 6/6；模型替身 2 次，真实模型 0 次，不代表线上用户与资金闭环
```
