"use strict";

const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const PIN = "ba5056621224f969eca75ce946403f8f70e95d23";
const PREFIXES = ["modules/safety-risk-eval", "docs/safety-risk-eval/contracts", "docs/safety-risk-eval/daily-policy-v1",
  "team-staging/risk/long-text", "chenchen/experiments", "chenchen/integrations", "chenchen/contracts",
  "chenchen/tools", "chenchen/data/demo-portfolio.json"];

function prepare(teamRepo) {
  const repo = path.resolve(teamRepo);
  execFileSync("git", ["-C", repo, "cat-file", "-e", PIN + "^{commit}"], { stdio: "pipe" });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "core-risk-acceptance-"));
  const archive = path.join(directory, "owner-source.tar");
  const sourceRoot = path.join(directory, "source");
  fs.mkdirSync(sourceRoot);
  execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "-C", repo, "archive", "--format=tar", "--output", archive, PIN, ...PREFIXES], { stdio: "pipe" });
  execFileSync("tar", ["-xf", archive, "-C", sourceRoot], { stdio: "pipe" });
  const files = execFileSync("git", ["-C", repo, "ls-tree", "-r", "-z", PIN, "--", ...PREFIXES]).toString("utf8")
    .split("\0").filter(Boolean).map(row => {
      const [entry, filename] = row.split("\t");
      return { path: filename, git_blob: entry.split(" ")[2] };
    });
  // This is a local test snapshot, not a copy into either delivery repository.
  fs.writeFileSync(path.join(directory, "source-manifest.json"), JSON.stringify({ commit: PIN, files }, null, 2));
  const dependencyRoot = path.join(sourceRoot, "docs/safety-risk-eval/contracts");
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd ci --ignore-scripts --no-audit --no-fund"], { cwd: dependencyRoot, stdio: "pipe" });
  } else {
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dependencyRoot, stdio: "pipe" });
  }
  return { owner_commit: PIN, directory, source_root: sourceRoot, files: files.length,
    source_modified: false, dependency_install: "npm ci --ignore-scripts", model_calls: 0 };
}
if (require.main === module) {
  const index = process.argv.indexOf("--team-repo");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node prepare-owner.js --team-repo <team checkout>");
  process.stdout.write(JSON.stringify(prepare(process.argv[index + 1]), null, 2) + "\n");
}
module.exports = { PIN, PREFIXES, prepare };
