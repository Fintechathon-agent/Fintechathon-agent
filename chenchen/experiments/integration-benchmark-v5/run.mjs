import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runSuite as runBatch } from "../investment-benchmark-v1/run.mjs";
import { generateCases, SEED } from "./cases.mjs";
import { runCase } from "./checks.mjs";

export async function runSuite({ outputDirectory, onProgress = () => {} }) {
  const cases = generateCases(), started = performance.now();
  assert.equal(cases.length, 10000); assert.equal(new Set(cases.map(c => c.case_id)).size, 10000);
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(path.join(outputDirectory, ".gitattributes"), "* text eol=lf\n*.gz binary\n", { flag: "wx" });
  const batches = [], failures = [], groups = new Map();
  for (let offset = 0; offset < cases.length; offset += 1000) {
    const chunk = cases.slice(offset, offset + 1000), folder = "batch-" + String(offset / 1000 + 1).padStart(2, "0");
    const report = await runBatch({ outputDirectory: path.join(outputDirectory, folder), seed: SEED,
      caseGenerator: () => chunk, caseRunner: runCase, expectedCount: 1000, evidenceEncoding: "gzip",
      suiteName: "investment-integration-v5", suiteTitle: "投资助手追加10000例分批测试",
      extraSourcePaths: ["experiments/investment-benchmark-v2/cases.mjs", "experiments/dual-benchmark-v3/cases.mjs", "experiments/dual-benchmark-v3/checks.mjs",
        "experiments/recovery-benchmark-v4/cases.mjs", "experiments/recovery-benchmark-v4/checks.mjs", "experiments/integration-benchmark-v5/cases.mjs",
        "experiments/integration-benchmark-v5/checks.mjs", "experiments/integration-benchmark-v5/run.mjs", "integrations/review-reservation.js",
        "integrations/review-transition.js", "integrations/owner-bridge.js", "integrations/risk-handoff.js", "integrations/review-evidence.js"],
      onProgress: row => { if (row.finished === 1000) onProgress({ finished: offset + 1000, failed: failures.length + row.failed }); } });
    batches.push({ folder, ...report });
    for (const group of report.groups) {
      const row = groups.get(group.group) || { group: group.group, cases: 0, passed: 0, failed: 0 };
      for (const key of ["cases", "passed", "failed"]) row[key] += group[key]; groups.set(group.group, row);
    }
    const results = fs.readFileSync(path.join(outputDirectory, folder, "results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    failures.push(...results.filter(r => !r.passed));
  }
  const sha = value => createHash("sha256").update(value).digest("hex");
  const report = { report_version: "investment-integration-benchmark.v5", recorded_at: new Date().toISOString(), seed: SEED,
    total: cases.length, passed: batches.reduce((n, r) => n + r.passed, 0), failed: failures.length, skipped: 0,
    templates: new Set(cases.map(c => c.group + ":" + c.template)).size,
    unique_inputs: new Set(cases.map(c => JSON.stringify({ group: c.group, template: c.template, input: c.input }))).size,
    dataset_sha256: sha(cases.map(c => JSON.stringify(c)).join("\n") + "\n"), groups: [...groups.values()],
    external_network_attempts: batches.reduce((n, r) => n + r.external_network_attempts, 0), external_model_calls: 0, paid_model_calls: 0,
    training_performed: false, joint_acceptance: false, model_mode: "FIXED_TEST_DOUBLES", risk_mode: "LOCAL_FIXTURES_NOT_FORMAL_OWNER_RULES",
    duration_ms: +(performance.now() - started).toFixed(3), source_head: batches[0].source_head, source_sha256: batches[0].source_sha256,
    batches: batches.map(r => ({ folder: r.folder, total: r.total, passed: r.passed, failed: r.failed,
      dataset_sha256: r.dataset_sha256, evidence_artifact: r.evidence_artifact })),
    limits: ["参数化程序测试，不是真实模型准确率或训练", "资金与账户全部虚构，未调用真实交易接口",
      "存储故障为内存注入和同进程服务对象重建，不是生产宕机演练", "并发是受控异步交错，不是公网压力测试",
      "真实Risk、登录身份、执行网关、手机端和联合验收本轮未验证"] };
  assert.ok(batches.every(r => JSON.stringify(r.source_sha256) === JSON.stringify(report.source_sha256)), "Sources changed during run");
  fs.writeFileSync(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(outputDirectory, "failures.jsonl"), failures.map(r => JSON.stringify(r)).join("\n") + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(outputDirectory, "测试报告.txt"), "\ufeff" + ["投资助手追加10000例测试", "通过：" + report.passed + "；失败：" + report.failed + "；跳过：0",
    "参数化模板：" + report.templates + "；不同完整输入：" + report.unique_inputs,
    ...report.groups.map(g => g.group + "：" + g.passed + "/" + g.cases), "数据指纹：" + report.dataset_sha256, "",
    "真实模型调用0，付费调用0，全部为本地模拟。", ...report.limits, ""].join("\n"), { flag: "wx" });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--output-dir");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--output-dir <new directory> required");
  const report = await runSuite({ outputDirectory: path.resolve(process.argv[index + 1]), onProgress: row => console.log(JSON.stringify(row)) });
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, templates: report.templates,
    unique_inputs: report.unique_inputs, dataset_sha256: report.dataset_sha256 }));
  if (report.failed || report.external_network_attempts) process.exitCode = 1;
}
