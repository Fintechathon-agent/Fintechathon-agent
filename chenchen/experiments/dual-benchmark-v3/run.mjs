import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite as runOriginal } from "../investment-benchmark-v1/run.mjs";
import { investmentCases, otherCases, INVESTMENT_SEED, OTHER_SEED } from "./cases.mjs";
import { runCase } from "./checks.mjs";

export function runSuite({ suite, outputDirectory, onProgress = () => {} }) {
  if (!["investment", "other"].includes(suite)) throw new TypeError("suite must be investment or other");
  return runOriginal({ outputDirectory, onProgress, suiteName: suite,
    suiteTitle: suite === "investment" ? "投资助手专项" : "其他功能专项",
    seed: suite === "investment" ? INVESTMENT_SEED : OTHER_SEED, expectedCount: 5000,
    caseGenerator: suite === "investment" ? investmentCases : otherCases, caseRunner: runCase,
    extraSourcePaths: ["experiments/investment-benchmark-v2/cases.mjs",
      "experiments/dual-benchmark-v3/cases.mjs", "experiments/dual-benchmark-v3/checks.mjs", "experiments/dual-benchmark-v3/run.mjs",
      "experiments/life-planning-v1/planning.js", "experiments/life-planning-v1/fixture.js", "merchant/ledger.js",
      "holdings-intake/experiments/account-summary-v1/adapter.js"] });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  if (!process.argv.includes("--suite") || !process.argv.includes("--output-dir")) throw new Error("--suite and --output-dir required");
  const suite = argument("--suite");
  const report = await runSuite({ suite, outputDirectory: path.resolve(argument("--output-dir")),
    onProgress: row => { if (row.finished % 500 === 0) console.log(JSON.stringify({ suite, ...row })); } });
  console.log(JSON.stringify({ suite, total: report.total, passed: report.passed, failed: report.failed,
    templates: report.parameterized_templates, dataset_sha256: report.dataset_sha256, external_network_attempts: report.external_network_attempts }));
  if (report.failed || report.external_network_attempts) process.exitCode = 1;
}
