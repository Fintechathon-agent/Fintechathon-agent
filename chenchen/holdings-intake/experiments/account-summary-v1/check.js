"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { reconcileAccountSummary, buildReviewCandidate, renderSummary } = require("./adapter");

function exportSummary(inputFile, outputDirectory, idempotencyKey) {
  if (fs.statSync(inputFile).size > 10000) throw new Error("Input exceeds 10000 bytes");
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8").replace(/^\uFEFF/, ""));
  const report = reconcileAccountSummary(input);
  const request = buildReviewCandidate(input, { idempotencyKey });
  fs.mkdirSync(outputDirectory);
  const write = (name, value) => fs.writeFileSync(path.join(outputDirectory, name), value, { flag: "wx" });
  write("reconciliation.json", JSON.stringify(report, null, 2) + "\n");
  write("review-request.json", JSON.stringify(request, null, 2) + "\n");
  write("账户汇总核对结果.txt", "\ufeff" + renderSummary(report));
  return { status: report.status, external_calls: 0, outputDirectory };
}

if (require.main === module) {
  const [input, output, idempotencyKey] = process.argv.slice(2);
  if (!input || !output || !idempotencyKey) throw new Error("Usage: node check.js <input.json> <new-output-directory> <idempotency-key>");
  console.log(JSON.stringify(exportSummary(path.resolve(input), path.resolve(output), idempotencyKey)));
}

module.exports = { exportSummary };
