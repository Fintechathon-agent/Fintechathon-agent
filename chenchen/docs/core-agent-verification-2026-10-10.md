# Core Agent 主链路核验报告 — 2026-10-10

核验批次：2026-10-10 北京时间 22:00 自动化；提交时间以 Git 记录为准。环境 Node v22.21.0 / npm 10.9.4。团队基线 4a1f4fe9737af12250ddcb6f0b9b51edaaf437a9，个人基线 836fb6f6906cf7942727ee272684bb0761e33743。两仓库分别实际执行；无业务代码修改。

## 已执行的检查与结果

在各仓库 chenchen 目录运行：

~~~powershell
npm run check
npm test
~~~

两仓库语法检查通过，各 52 项通过、0 失败、0 跳过（51 个顶层测试及 1 个嵌套测试）。现有用例覆盖缺偏好澄清、Session 绑定、工具失败恢复、输入变化失效、熔断、Memory consent/session-only、Quant 固定种子回放与 Risk 只读边界。测试包括其他既有产品用例；不能把 52 项全部称为 Core Agent 集成测试。

下面的额外检查在临时随机端口启动当前仓库服务，运行原有 scripts/smoke.js（等价于 npm run smoke 的脚本入口），核对 19 个页面/静态资源与本地文件，并执行字段追踪。全部完成后关闭测试服务。

| 核验 | 两仓库实际结果 |
| --- | --- |
| health-check / audit 读取 / 同 task 续跑 / bridge | HTTP 200 / 200 / 200 / 200 |
| 缺字段 Contract / 伪造客户端 approval | HTTP 422 INVALID_CONTRACT / 503 |
| trace 与 TaskState、AuditEvidence | version/request/task/session 四键相等 |
| checkpoint.result_refs | 4 个引用均解析到 tool_results；带市场证据共 5 个 ToolResult |
| audit_id | Handoff evidence 与 AuditEvidence 相等；续跑保持 audit_id |
| 续跑 request_id | 信封更新为最新 request_id，历史 contract.accepted payload 仍保留旧值 |
| 审计事件顺序 | 实际 stage.handoff 在 contract.accepted 之前，已据此修订时序图 |
| Risk bridge | READ_ONLY_HANDOFF_PREVIEW；can_import_external_handoff=false；不执行远程写入 |
| 金融数据 | 2026-10-08/09 固定夹具回放通过；2026-10-09 rates-view-data-conflict 待复核 |
| Quant 不漂移 | 现有 market-brief 测试逐项比对 metrics、候选 target_weights、simulation.comparisons 通过 |
| 授权停止点 | HANDOFF_REQUIRED / PENDING_REVIEW / execution_allowed=false |

金融结论仅验证已提交固定夹具与现有工具，不验证当日实时行情；fixture 中 REVIEW_REQUIRED 不产生自动交易。未读取真实用户数据，未修改 Quant、Memory、Risk、UI 实现。

## 可复现字段追踪命令

在各仓库 chenchen 目录执行以下 PowerShell 命令，进程返回 0 才表示检查通过：

~~~powershell
@'
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {server} = require('./server');
const contract = require('./contracts/investment-contract');
const profile = {investment_horizon_days:365,max_drawdown:0.1,liquidity_need:'medium'};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['scripts/smoke.js'],{env:{...process.env,PORT:String(server.address().port)},stdio:'inherit'});
   child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error('smoke exit '+code)));
  });
  const req=contract.createRequest({requestId:'req-daily-20261010-trace',riskProfile:profile,marketContext:require('./data/market-brief-2026-10-09.json')});
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const first=await post('/api/health-check/run',req); assert.equal(first.status,200);
  const x=contract.assertHealthCheckResponse(first.body),s=x.task_state;
  for(const k of ['contract_version','request_id','task_id','session_id']) {
   assert.equal(x.trace[k],x.audit_evidence[k]); assert.equal(x.trace[k],s[k]);
  }
  for(const ref of Object.values(s.checkpoint.result_refs)) assert.ok(x.tool_results[ref]);
  assert.equal(Object.keys(s.checkpoint.result_refs).length,4);
  assert.equal(x.risk_handoff.evidence.audit_id,x.audit_evidence.audit_id);
  assert.equal(x.risk_handoff.execution_allowed,false);
  const ev=x.audit_evidence.events.map(e=>e.event_type);
  assert.ok(ev.indexOf('contract.accepted')>ev.indexOf('stage.handoff'));
  const read=await fetch(base+'/api/audit/'+s.task_id); assert.equal(read.status,200);
  assert.deepEqual((await read.json()).audit_evidence,x.audit_evidence);
  const again=await post('/api/health-check/run',{...req,request_id:'req-daily-20261010-repeat',context:{...req.context,task_id:s.task_id,session_id:s.session_id}});
  assert.equal(again.status,200); assert.equal(again.body.task_state.task_id,s.task_id);
  assert.equal(again.body.audit_evidence.request_id,'req-daily-20261010-repeat');
  assert.equal(again.body.audit_evidence.audit_id,x.audit_evidence.audit_id);
  assert.ok(again.body.audit_evidence.events.some(e=>e.payload.request_id===req.request_id));
  const bridge=await post('/api/risk-workbench/handoff',{request:req}); assert.equal(bridge.status,200);
  assert.equal(bridge.body.risk_workbench.integration_mode,'READ_ONLY_HANDOFF_PREVIEW');
  assert.equal(bridge.body.risk_workbench.remote_capability.can_import_external_handoff,false);
  const bad=await post('/api/health-check/run',{request_id:'req-daily-invalid'});assert.equal(bad.status,422);contract.assertHealthCheckError(bad.body);
  const forged=await post('/api/paper-trade/execute',{approval:{status:'APPROVED',token:'synthetic-client-token'}});assert.equal(forged.status,503);
  console.log(JSON.stringify({health_http:first.status,audit_http:read.status,repeat_http:again.status,bridge_http:bridge.status,invalid_contract_http:bad.status,forged_approval_http:forged.status,checkpoint_refs:4,tool_results:Object.keys(x.tool_results).length,trace_keys:4,event_order:'stage.handoff before contract.accepted',repeat_request:'audit envelope is latest request; earlier contract.accepted retained',conflicts:x.artifacts.market_context.unresolved_conflicts.map(v=>({signal_id:v.signal_id,status:v.status})),execution_allowed:false}));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
'@ | node
~~~

## 当前限制和责任方

- Risk：独立 Consumer 和审核回写未接入；需冻结接收路径、证据关联、review_status/rejection_reason/decision 与权限语义。HTTP 200 仅证明本地适配。
- Backend：失败响应 task/session/audit 关联、跨续跑事件 request 归因、语义校验以及持久化恢复尚待协议确认；本报告不把成功路径检查扩大为这些缺口已修复。
- Memory：主链路未自动读取 Memory；跨模块读取接口和 audit 留痕归属需 Owner 确认，当前 consent、范围、生命周期、清理完全不变。
- Quant/UI：需确认既有输出及展示字段的版本兼容；其他 import/diagnose/strategy/simulation HTTP 端点尚未统一版本化。
- Data：需给出真实数据源、as_of/可信度/刷新及冲突规范，才能替换 SYNTHETIC_REPLAY。

## 文档产出

修订 core-agent-architecture.md、core-agent-sequence.md 与 ../contracts/README.md 字段责任表。保持 investment-agent.v1 运行时 Schema 和版本不变；新增/修订内容只澄清实际边界与协议缺口。提交前在两个仓库根目录执行 git diff --check，日报与报告共同提交；远程提交核对在运行结束汇总中记录。
