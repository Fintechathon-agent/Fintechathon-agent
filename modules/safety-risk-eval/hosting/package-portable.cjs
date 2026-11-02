"use strict";
// Windows fallback after the official source workflow has pushed the exact source.
// Credentials arrive on stdin, are kept in memory, and are never logged or persisted.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const [project, archive, prepareHelper] = process.argv.slice(2).map((p) => path.resolve(p));
process.stdin.setEncoding("utf8");
let input = "";
console.log("Ready for source verification credential on stdin (input is hidden).");
if (process.stdin.isTTY) { process.stdin.setRawMode(true); }
process.stdin.on("data", (chunk) => {
  if (process.stdin.isTTY) {
    for (const c of chunk) {
      if (c === "\r" || c === "\n") { finish(); return; }
      if (c === "\u0003") process.exit(130);
      input += c;
    }
  } else { input += chunk; if (input.includes("\n")) finish(); }
});
function finish() {
  process.stdin.pause();
  try {
    const credential = JSON.parse(input).credential;
    const remote = new URL(credential.remote_url);
    if (remote.protocol !== "https:" || remote.username || remote.password || !credential.token) throw new Error("Invalid credential");
    const exec = (cmd, args, env = process.env) => {
      const r = spawnSync(cmd, args, { cwd: project, env, encoding: "utf8", timeout: 30000 });
      if (r.status !== 0) throw new Error(`Step ${path.basename(cmd)} failed: ${r.error?.code || r.status}`);
      return r.stdout.trim();
    };
    const sha = exec("git", ["rev-parse", "HEAD"]);
    if (exec("git", ["status", "--porcelain"])) throw new Error("Site source is not clean");
    const env = { ...process.env, SITES_GIT_AUTHORIZATION: `Authorization: Bearer ${credential.token}`, GIT_TERMINAL_PROMPT: "0" };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_TRACE") || key === "GIT_CURL_VERBOSE") delete env[key];
    const remoteSha = exec("git", ["-c", "http.proxy=http://127.0.0.1:7892", "-c", "http.version=HTTP/1.1", "-c", "credential.helper=", "-c", "http.extraHeader=", "--config-env=http.extraHeader=SITES_GIT_AUTHORIZATION", "ls-remote", credential.remote_url, `refs/heads/${credential.branch}`], env).split(/\s+/)[0];
    if (sha !== remoteSha) throw new Error("Remote source does not match archive source");
    const stage = path.resolve(project, `.sites-runtime/package-${randomUUID()}`);
    if (!stage.startsWith(project + path.sep)) throw new Error("Invalid staging path");
    fs.mkdirSync(stage, { recursive: true });
    try {
      exec(process.execPath, [prepareHelper, project, path.join(stage, "dist")]);
      const sourceHosting = JSON.parse(fs.readFileSync(path.join(project, ".openai/hosting.json"), "utf8"));
      const stagedHosting = path.join(stage, "dist/.openai/hosting.json");
      fs.mkdirSync(path.dirname(stagedHosting), { recursive: true });
      const normalized = sourceHosting.static ? JSON.parse(fs.readFileSync(stagedHosting, "utf8")) : sourceHosting;
      fs.writeFileSync(stagedHosting, JSON.stringify(normalized, null, 2));
      if (fs.existsSync(path.join(project, "drizzle"))) fs.cpSync(path.join(project, "drizzle"), path.join(stage, "dist/.openai/drizzle"), { recursive: true });
      exec("tar", ["-czf", archive, "-C", stage, "dist"]);
      const entries = exec("tar", ["-tzf", archive]);
      if (!entries.includes("dist/.openai/hosting.json")) throw new Error("Archive missing hosting manifest");
      console.log(JSON.stringify({ project_id: sourceHosting.project_id, commit_sha: sha, archive }));
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
