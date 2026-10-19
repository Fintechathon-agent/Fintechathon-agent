import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite as runOriginal } from "../investment-benchmark-v1/run.mjs";
import { generateCases, SEED } from "./cases.mjs";
import { runCase } from "./checks.mjs";

export function runSuite({ outputDirectory, onProgress = () => {} }) {
  return runOriginal({ outputDirectory, onProgress, seed: SEED, expectedCount: 5000,
    suiteName: "investment-recovery", suiteTitle: "投资助手资金与故障恢复专项", evidenceEncoding: "gzip",
    caseGenerator: generateCases, caseRunner: runCase,
    extraSourcePaths: ["experiments/investment-benchmark-v2/cases.mjs", "experiments/dual-benchmark-v3/cases.mjs",
      "experiments/dual-benchmark-v3/checks.mjs", "experiments/recovery-benchmark-v4/cases.mjs",
      "experiments/recovery-benchmark-v4/checks.mjs", "experiments/recovery-benchmark-v4/run.mjs",
      "integrations/owner-bridge.js", "integrations/review-evidence.js"] });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--output-dir");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--output-dir <new directory> required");
  const report = await runSuite({ outputDirectory: path.resolve(process.argv[index + 1]),
    onProgress: row => { if (row.finished % 500 === 0) console.log(JSON.stringify(row)); } });
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed,
    templates: report.parameterized_templates, dataset_sha256: report.dataset_sha256, evidence: report.evidence_artifact }));
  if (report.failed || report.external_network_attempts) process.exitCode = 1;
}
