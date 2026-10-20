const names = {
  portfolio_chain: ["持仓分析", "从输入持仓到生成分析，并检查易读报告能否使用同一份结果。"],
  funding_multitask: ["多笔投资同时用钱", "多项任务不能重复占用同一笔钱。"],
  risk_workflow: ["风控与人工确认", "未通过风控、未确认或已拒绝时，模拟执行必须停住。"],
  reliability: ["请求失败与重复提交", "模型超时、重复点击等情况下，不能假装成功。"],
  investment_lifecycle: ["投资与生活费冲突", "房租学费已预留、金额变化、撤回等情况下如何处理。"],
  storage_fault: ["保存记录时出错", "没有确认保存成功时，不能继续放行。"],
  concurrent_workflow: ["多个操作交错发生", "取消、审批、回调或重复请求交错时，记录仍保持一致。"],
  funding_batch: ["多任务资金安排", "差一分钱、房租上调、审批过期时也要拦住。"],
  signed_owner_boundary: ["是谁批准了哪件事", "不能把别人的审批、被改过的回调用到当前任务。"],
  readable_report: ["报告是否说清楚", "缺数据不编数字，涨跌不说反，旧日期和模拟边界说清楚。"]
};
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function readableBenchmarkReport(report, failures = []) {
  for (const field of ["total", "passed", "failed", "skipped"]) if (!Number.isSafeInteger(report[field]) || report[field] < 0) throw new Error("Invalid test counts");
  if (report.total !== report.passed + report.failed + report.skipped || failures.length !== report.failed ||
      ["cases", "passed", "failed"].some((key, i) => report.groups.reduce((n, g) => n + g[key], 0) !== report[["total", "passed", "failed"][i]])) throw new Error("Test counts do not match");
  const title = "投资助手 · 10,000 例测试易读报告";
  const conclusion = report.failed ? "发现 " + report.failed + " 例未通过，需要处理后用原案例重新验证。" : "本轮列出的案例全部通过；这不等于已经完成真实上线验收。";
  const groups = report.groups.map(g => ({ ...g, title: names[g.group]?.[0] || "其他检查（" + g.group + "）", explanation: names[g.group]?.[1] || "详见案例记录。" }));
  const boundaries = ["本轮使用虚构数据和本地模型、风控替身；没有花钱调用模型，也没有真实交易。",
    "这 10,000 例是不同参数的程序检查，不是 10,000 位用户，也不是模型答题正确率。",
    "真实模型、正式风控、身份登录和公网手机操作，还没有通过本轮联合验收。",
    "本轮没有修改投资计算方法、记忆规则或审批门槛。"];
  const failedRows = failures.slice(0, 50).map(f => ({ id: f.case_id, group: names[f.group]?.[0] || f.group, check: f.template,
    reason: f.error?.message || "详见原始结果" }));
  const text = [title, "", "一、一眼看结果", conclusion,
    "共 " + report.total + " 例；通过 " + report.passed + " 例；未通过 " + report.failed + " 例；跳过 " + report.skipped + " 例。",
    "", "二、具体检查了什么", ...groups.map(g => g.title + "：" + g.passed + "/" + g.cases + " 通过，未通过 " + g.failed + "。\n  " + g.explanation),
    "", "三、发现的问题", ...(failedRows.length ? failedRows.map(f => f.id + "｜" + f.group + "｜" + f.check + "\n  " + f.reason) : ["本轮未发现所列案例中的失败；未覆盖的情况仍可能存在问题。"]),
    ...(failures.length > 50 ? ["这里列前 50 例，全部失败保存在 failures.jsonl。"] : []),
    "", "四、哪些可以确认，哪些还不能", ...boundaries,
    "", "五、下一步", report.failed ? "先修复上面的问题，再使用同一组数据复测，保留首轮失败记录。" : "请团队继续核对真实服务、审批和模拟回执；本地通过不能替代联合验收。",
    "", "六、详细记录在哪里", "每批 1,000 例，存放在 batch-01 至 batch-10。cases.jsonl 是输入，results.jsonl 是逐例结果。",
    "压缩的 workflow-evidence.jsonl.gz 保存完整流程证据；report.json 保存统计。",
    "模板数：" + report.templates + "；不同完整输入：" + report.unique_inputs + "；固定种子：" + report.seed,
    "数据指纹：" + report.dataset_sha256, "生成时间（UTC）：" + report.recorded_at, ""].join("\n");
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><style>' +
    'body{margin:0;background:#f3f5f2;color:#182c25;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:940px;margin:auto;padding:28px 20px}h1{font-size:clamp(26px,5vw,38px);line-height:1.3}h2{font-size:21px}.lead{font-size:20px}.muted,small{color:#53655c}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card,section{padding:20px;background:white;border:1px solid #d9e2dc;border-radius:14px;margin:16px 0}.card strong{display:block;font-size:32px}table{border-collapse:collapse;width:100%}td,th{padding:12px 8px;text-align:left;border-bottom:1px solid #e6ebe7}td small{display:block}.table{overflow:auto}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176349}@media(max-width:540px){main{padding:20px 12px}.cards{gap:8px}.card{padding:12px}.card strong{font-size:25px}section{padding:16px}td,th{padding:9px 5px}}' +
    '</style><main><p class="muted">本地模拟 · 真实服务待验收</p><h1>' + title + '</h1><p class="lead">' + esc(conclusion) + '</p><div class="cards">' +
    [["通过", report.passed], ["未通过", report.failed], ["跳过", report.skipped]].map(([label, value]) => '<div class="card">' + label + '<strong>' + value + '</strong></div>').join("") +
    '</div><a href="测试报告.txt" download>下载文字版</a><section><h2>检查了什么？</h2><div class="table"><table><thead><tr><th>检查内容</th><th>通过 / 总数</th><th>未通过</th></tr></thead><tbody>' +
    groups.map(g => '<tr><td>' + esc(g.title) + '<small>' + esc(g.explanation) + '</small></td><td>' + g.passed + ' / ' + g.cases + '</td><td>' + g.failed + '</td></tr>').join("") +
    '</tbody></table></div></section><section><h2>发现了什么？</h2>' + (failedRows.length ? failedRows.map(f => '<details><summary>' + esc(f.id + ' · ' + f.group + ' · ' + f.check) + '</summary><pre>' + esc(f.reason) + '</pre></details>').join("") : '<p>所列案例中没有失败。仍需继续验证真实服务。</p>') +
    (failures.length > 50 ? '<p>这里列前50例，完整清单见下方失败记录。</p>' : '') + '<a href="failures.jsonl">查看完整失败记录</a></section><section><h2>接下来还要做什么？</h2><ul>' + boundaries.map(x => '<li>' + esc(x) + '</li>').join("") + '</ul></section>' +
    '<details class="card"><summary>查看测试方法与原始记录</summary><pre>' + esc(text.slice(text.indexOf("六、详细记录在哪里"))) + '</pre><a href="report.json">原始统计</a></details></main></html>';
  return { text, html };
}
