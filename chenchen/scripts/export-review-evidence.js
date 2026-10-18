"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildReviewEvidence, sha256 } = require("../integrations/review-evidence");
const MAX_BYTES = 10 * 1024 * 1024;

function exportFile(inputFile, outputDirectory, { includeContent = false } = {}) {
  const input = path.resolve(inputFile), output = path.resolve(outputDirectory);
  if (!fs.statSync(input).isFile() || fs.statSync(input).size > MAX_BYTES) throw new Error("输入必须为不超过 10 MiB 的 JSON 文件。");
  const bytes = fs.readFileSync(input);
  if (bytes.length > MAX_BYTES) throw new Error("输入文件超过 10 MiB。");
  const record = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const result = buildReviewEvidence(record, { includeContent, sourceSha256: sha256(bytes) });
  // A new directory is mandatory. Never overwrite an earlier evidence package.
  fs.mkdirSync(output);
  const textBytes = Buffer.from("\uFEFF" + result.text, "utf8");
  fs.writeFileSync(path.join(output, "任务记录.txt"), textBytes, { flag: "wx" });
  result.manifest.files = [{ name: "任务记录.txt", sha256: sha256(textBytes), bytes: textBytes.length }];
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n", { flag: "wx" });
  return result.manifest;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === "--include-content") { options.includeContent = true; continue; }
      if (!["--input", "--output-dir"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--") || options[key]) throw new Error("参数错误：--input <完整任务.json> --output-dir <新的目录> [--include-content]");
      options[key] = args[++i];
    }
    if (!options["--input"] || !options["--output-dir"]) throw new Error("用法：node scripts/export-review-evidence.js --input <完整任务.json> --output-dir <新的目录> [--include-content]");
    const result = exportFile(options["--input"], options["--output-dir"], options);
    console.log(JSON.stringify({ consistency_status: result.consistency_status, event_count: result.event_count,
      content_included: result.content_included, joint_acceptance: false }));
    if (result.consistency_status === "INCONSISTENT") process.exitCode = 2;
  } catch (error) {
    console.error(error.code === "EEXIST" ? "目标目录已存在；请换一个新目录，旧证据未覆盖。" : "导出失败：" + error.message);
    process.exitCode = 1;
  }
}

module.exports = { exportFile };
