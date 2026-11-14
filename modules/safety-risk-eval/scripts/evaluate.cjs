"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const repo = path.resolve(root, "../..");
const destination = path.join(repo, "docs/safety-risk-eval/implementation-v0.1");
const files = fs.readdirSync(path.join(root, "test")).filter((name) => name.endsWith(".test.cjs")).sort().map((name) => `test/${name}`);
const suites = [
  { name: "Risk / Gateway / Core integration", cwd: root, files },
  { name: "Draft contract regression", cwd: path.join(repo, "docs/safety-risk-eval/contracts"), files: ["tests/contracts.test.cjs"] },
  { name: "Existing team contract regression", cwd: repo, files: ["chenchen/tests/contracts.test.js"] }
];
const results = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...suite.files], { cwd: suite.cwd, encoding: "utf8" });
  const output = (result.stdout || "") + (result.stderr || "");
  results.push({ name: suite.name, command: ["node", "--test", "--test-reporter=tap", ...suite.files].join(" "), exit_code: result.status, tests: Number(/# tests (\d+)/.exec(output)?.[1] || 0), passed: Number(/# pass (\d+)/.exec(output)?.[1] || 0), failed: Number(/# fail (\d+)/.exec(output)?.[1] || 0) });
  if (result.status !== 0) { console.error(output); process.exit(1); }
}
const sources = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(cjs|js|html|css|json)$/.test(e.name)) sources.push({ path: path.relative(repo, p).replaceAll("\\", "/"), sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex") });
  }
}
walk(root);
const report = { generated_at: new Date().toISOString(), scope: "Local synthetic implementation, contract and integration tests; not production security certification or live financial execution", runtime: process.version, suites: results, sources };
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, "eval-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(results));
