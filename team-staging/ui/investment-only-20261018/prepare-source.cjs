"use strict";

// Reconstruct the isolated candidate without touching the team's current sources.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "source-manifest.json"), "utf8"));
const repository = cp.execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: __dirname, encoding: "utf8" }).trim();
const git = args => cp.execFileSync("git", args, { cwd: repository });
git(["cat-file", "-e", manifest.sourceBaseCommit + "^{commit}"]);
const target = fs.mkdtempSync(path.join(os.tmpdir(), "xinlan-investment-candidate-"));
function destination(relative) {
  const file = path.resolve(target, relative);
  if (!file.startsWith(target + path.sep)) throw new Error("Unsafe candidate path");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}
const dependencies = ["chenchen/core", "chenchen/tools", "chenchen/merchant", "chenchen/data", "chenchen/contracts", "chenchen/tests", "chenchen/package-lock.json"];
const entries = git(["ls-tree", "-r", "-z", manifest.sourceBaseCommit, "--", ...dependencies]).toString().split("\0").filter(Boolean);
for (const entry of entries) {
  const [metadata, relative] = entry.split("\t");
  const [, type, object] = metadata.split(" ");
  if (type !== "blob") continue;
  fs.writeFileSync(destination(relative), git(["cat-file", "blob", object]));
}
for (const item of manifest.files) {
  const source = path.resolve(__dirname, item.stored_as);
  if (!source.startsWith(__dirname + path.sep)) throw new Error("Unsafe source path");
  const bytes = fs.readFileSync(source);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Candidate source integrity check failed");
  fs.writeFileSync(destination(item.file), bytes);
}
fs.writeFileSync(path.join(target, "chenchen/.gitignore"), ".env\n.env.*\nnode_modules/\nartifacts/\ndist-static/\n");
console.log(JSON.stringify({ runtimePath: path.join(target, "chenchen"), sourceBaseCommit: manifest.sourceBaseCommit, secretsCopied: false }));
