import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const projectId = "appgprj_6ac9a87727948191a202fedf09841f82";
const hash = x => createHash("sha256").update(x).digest("hex");
const baseHash = "3063fd721e5d49d69a9fa29de1aab932564b8f9dd4b291fb9c58eaa12410ae5f";
const entryHash = "1e853cfbbfe8a4c4e5bbb99c0e2e381d072457d1d75c4a77e74da9eeefe91d57";
function once(source, before, after) {
  if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error("Reviewed source anchor changed; stop and inspect the new Site version.");
  return source.replace(before, after);
}
// The two pure evaluators require JSON only. Emit static ESM, no eval, runtime
// require or duplicate hand-written evaluation logic in the Worker build.
function emitModule(name, replacements) {
  let source = fs.readFileSync(path.join(here, name + ".cjs"), "utf8").replace(/\r\n/g, "\n");
  for (const [before, value] of replacements) source = once(source, before, JSON.stringify(value));
  source = once(source, "module.exports =", "export const exported =");
  const names = name === "assessment" ? "deriveAssessment" : "authorizeCapability, POLICY_VERSION, RESULT_VERSION";
  if (/\brequire\(/.test(source)) throw new Error("Unexpected evaluator dependency.");
  return source + `\nexport { ${names} };\n`;
}
export async function installSite(directory) {
  const root = path.resolve(directory), manifest = JSON.parse(fs.readFileSync(path.join(root, ".openai/hosting.json")));
  if (manifest.project_id !== projectId) throw new Error("Wrong Site selected.");
  const server = path.join(root, "dist/server"), entry = path.join(server, "index.js");
  const original = fs.readFileSync(path.join(server, "index-base.js"));
  if (hash(original) !== baseHash || hash(fs.readFileSync(entry, "utf8").replace(/\r\n/g, "\n")) !== entryHash) throw new Error("This installer requires the reviewed version 12 baseline; never overwrite newer work.");
  const docs = path.resolve(here, "../../../docs/safety-risk-eval");
  const policy = JSON.parse(fs.readFileSync(path.join(docs, "unified-rating-v1/risk-policy.json"))), matrix = JSON.parse(fs.readFileSync(path.join(docs, "unified-rating-v1/permission-matrix.json")));
  const daily = JSON.parse(fs.readFileSync(path.join(docs, "daily-policy-v1/policy-config.v1.json")));
  const assessment = emitModule("assessment", [[`require("../../../docs/safety-risk-eval/unified-rating-v1/risk-policy.json")`, policy], [`require("../../../docs/safety-risk-eval/daily-policy-v1/policy-config.v1.json")`, daily]]);
  const permission = emitModule("permission", [[`require("../../../docs/safety-risk-eval/unified-rating-v1/permission-matrix.json")`, matrix]]);
  fs.writeFileSync(path.join(server, "assessment.mjs"), assessment); fs.writeFileSync(path.join(server, "permission.mjs"), permission);
  fs.writeFileSync(path.join(server, "permission-catalog.mjs"), "export default " + JSON.stringify(matrix) + ";\n");
  fs.copyFileSync(path.join(here, "site-bridge.mjs"), path.join(server, "unified-bridge.mjs"));
  let base = original.toString().replace(/\r\n/g, "\n");
  base = `import { enrichDailyRecord, paperWritePermission } from "./unified-bridge.mjs";\n` + base;
  base = once(base, '        result = await gatewayFor(payload.task_id).execute(payload.task_id, actor, payload.idempotency_key);', `        const selected = gatewayFor(payload.task_id), owned = selected.inspect(payload.task_id, actor);
        const permission = paperWritePermission(owned.input.binding.task_id);
        selected.event("UNIFIED_PERMISSION_CHECKED", owned, { permission, execution_allowed: false });
        await store.flush();
        if (permission.decision !== "ALLOW") return json({ permission, execution_allowed: false, executed: false, error: { code: permission.code, message: permission.message_zh } }, 403, session);
        result = await selected.execute(payload.task_id, actor, payload.idempotency_key);`);
  base = once(base, '      await store.flush();\n      return json(result, 200, session);', `      result = enrichDailyRecord(result);
      if (result?.unified_assessment && request.method === "POST" && ["/api/safety/daily/tasks", "/api/safety/daily/revise"].includes(url.pathname)) {
        dailyGateway.event("UNIFIED_ASSESSMENT_RECORDED", result, { unified_assessment: result.unified_assessment, permission: result.unified_permission, execution_allowed: false });
      }
      await store.flush();
      return json(result, 200, session);`);
  fs.writeFileSync(path.join(server, "index-unified-base.js"), base);
  let wrapper = fs.readFileSync(entry, "utf8").replace(/\r\n/g, "\n");
  wrapper = once(wrapper, 'import base from "./index-base.js";', 'import base from "./index-unified-base.js";\nimport { describeUnifiedPolicy } from "./unified-bridge.mjs";');
  wrapper = once(wrapper, '  const url = new URL(request.url);', `  const url = new URL(request.url);
  if (url.pathname === "/api/safety/unified-policy") {
    if (request.method !== "GET") return Response.json({error:{code:"METHOD_NOT_ALLOWED",message:"规则说明仅支持读取。"},execution_allowed:false},{status:405,headers:{...headers,Allow:"GET"}});
    return Response.json(describeUnifiedPolicy(),{headers});
  }`);
  const assets = structuredClone((await import(pathToFileURL(path.join(server, "network-assets.mjs")).href)).default);
  assets["/risk"].body = once(assets["/risk"].body, '<script src="/risk/app.js" defer>', '<link rel="stylesheet" href="/risk/unified.css"><script src="/risk/unified.js" defer></script><script src="/risk/app.js" defer>');
  assets["/risk/daily.js"].body = once(assets["/risk/daily.js"].body, '    const review = task.review, state = executionState();', '    window.UnifiedRisk.render(task);\n    const review = task.review, state = executionState();');
  assets["/risk/daily.js"].body = once(assets["/risk/daily.js"].body, 'function markDirty() { dirty = Boolean(task);', 'function markDirty() { dirty = Boolean(task); if (task) window.UnifiedRisk.invalidate();');
  assets["/risk/daily.js"].body = once(assets["/risk/daily.js"].body, 'const eventLabels = {', 'const eventLabels = { UNIFIED_ASSESSMENT_RECORDED: "统一风险评级已记录", UNIFIED_PERMISSION_CHECKED: "权限检查已记录",');
  assets["/risk"].body = once(assets["/risk"].body, '会话沙箱模拟</h2>', '执行权限与历史回执</h2>');
  assets["/risk"].body = once(assets["/risk"].body, '服务器在写入前重查最新账本、版本、审批与审计。正式银行账户和团队正式执行权限均未在此开通。', '当前策略关闭新的模拟资金写入。通过检查、确认计划均不会开启写入；历史回执和原任务状态仍可查看。');
  for (const route of ["/risk/app.js", "/risk/daily.js"]) assets[route].body = once(assets[route].body, 'window.RiskConnection.enforceButtons();', 'window.RiskConnection.enforceButtons(); window.UnifiedRisk.enforce();');
  for (const [ext, type] of [["js", "text/javascript"], ["css", "text/css"]]) assets["/risk/unified." + ext] = {body:fs.readFileSync(path.join(here, "workbench."+ext),"utf8"),type:type+"; charset=utf-8"};
  fs.writeFileSync(path.join(server, "network-assets.mjs"), "export default " + JSON.stringify(assets) + ";\n"); fs.writeFileSync(entry, wrapper);
  const result = { project_id:projectId, baseline_site_version:12, original_base_sha256:baseHash, original_base_unchanged:true,
    entry_sha256:hash(wrapper), unified_base_sha256:hash(base), policy_version:policy.policy_version,
    implemented_scope:"DAILY_ASSESSMENT_AND_PAPER_WRITE_DENIAL", all_capability_routes_integrated:false, joint_acceptance:false,
    source_files:Object.fromEntries(["assessment.cjs","permission.cjs","site-bridge.mjs","workbench.js","workbench.css","install-site.mjs"].map(f=>[f,hash(fs.readFileSync(path.join(here,f)))])) };
  fs.writeFileSync(path.join(root,"unified-risk-provenance.json"),JSON.stringify(result,null,2)+"\n"); return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await installSite(process.argv[2]),null,2));
