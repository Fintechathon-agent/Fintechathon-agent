import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite as runOriginalSuite } from "../investment-benchmark-v1/run.mjs";
import { generateCases, SEED } from "./cases.mjs";

export function runSuite(options) {
  return runOriginalSuite({ ...options, seed: options.seed ?? SEED, caseGenerator: generateCases,
    expectedCount: 2000, extraSourcePaths: ["experiments/investment-benchmark-v2/cases.mjs", "experiments/investment-benchmark-v2/run.mjs"] });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--output-dir");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--output-dir <new directory> required");
  const report = await runSuite({ outputDirectory: path.resolve(process.argv[index + 1]),
    onProgress: row => console.log(JSON.stringify(row)) });
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed,
    dataset_sha256: report.dataset_sha256, external_network_attempts: report.external_network_attempts }));
  if (report.failed || report.external_network_attempts) process.exitCode = 1;
}
