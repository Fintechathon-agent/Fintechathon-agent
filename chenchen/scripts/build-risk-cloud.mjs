import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build output only. Owner files are read from a fixed PR snapshot, never edited.
const [snapshotArg, esbuildArg, outputArg] = process.argv.slice(2);
if (!snapshotArg || !esbuildArg || !outputArg) throw new Error("Usage: node build-risk-cloud.mjs PR27_ROOT ESBUILD_DIRECTORY OUTPUT_DIRECTORY");
const snapshot = path.resolve(snapshotArg), output = path.resolve(outputArg);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapters = path.join(snapshot, "modules/safety-risk-eval/interface-adapters");
const requireOwner = createRequire(path.join(adapters, "package.json"));
const requireBuild = createRequire(path.join(path.resolve(esbuildArg), "package.json"));
const esbuild = requireBuild(".");
const Ajv = requireOwner("ajv/dist/2020"), standalone = requireOwner("ajv/dist/standalone").default;
const schema = JSON.parse(await readFile(path.join(root, "contracts/risk-handoff.v1.schema.json"), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true } });
for (const name of ["agent-output.v1", "model-review.v1", "owner-bridge.v1", "funding-plan-demo.v1"]) ajv.addSchema(JSON.parse(await readFile(path.join(root, `contracts/${name}.schema.json`), "utf8")));
ajv.addSchema(schema);
const validator = standalone(ajv, ajv.compile({ $ref: `${schema.$id}#/$defs/HandoffPackage` }));
const sourceHashes = {};
const sourceCommit = "27bdefbbb38c7d4e7b7dc1f975217862832d1d6f";
let pinnedFiles = 0;
await mkdir(output, { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, "deployment/risk-worker.js")], outfile: path.join(output, "risk-worker.mjs"), bundle: true,
  format: "esm", platform: "neutral", target: "es2022", conditions: ["workerd", "worker", "browser"],
  plugins: [{ name: "fixed-risk-owner-snapshot", setup(build) {
    // Convert CJS built-in requires into native ESM imports before bundling.
    build.onResolve({ filter: /^node:/ }, args => args.kind === "require-call"
      ? { path: args.path, namespace: "node-esm" } : { path: args.path, external: true });
    build.onLoad({ filter: /.*/, namespace: "node-esm" }, args => ({ contents: `export * from ${JSON.stringify(args.path)};`, loader: "js" }));
    build.onResolve({ filter: /^risk-owner\// }, args => ({ path: path.join(adapters, args.path.slice("risk-owner/".length)) }));
    build.onResolve({ filter: /^generated-risk-handoff-validator$/ }, () => ({ path: "validator", namespace: "standalone" }));
    build.onLoad({ filter: /.*/, namespace: "standalone" }, () => ({ contents: validator, loader: "js", resolveDir: adapters }));
    build.onLoad({ filter: /\.(?:cjs|json)$/ }, async args => {
      if (!args.path.startsWith(snapshot + path.sep) || args.path.includes(`${path.sep}node_modules${path.sep}`)) return;
      const raw = await readFile(args.path, "utf8");
      const relative = path.relative(snapshot, args.path).replaceAll("\\", "/");
      const pinned = spawnSync("git", ["show", `${sourceCommit}:${relative}`], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      if (pinned.status !== 0 || pinned.stdout.replaceAll("\r\n", "\n") !== raw.replaceAll("\r\n", "\n")) throw new Error(`Risk Owner source differs from fixed PR27: ${relative}`);
      pinnedFiles++;
      sourceHashes[relative] = createHash("sha256").update(raw).digest("hex");
      if (path.resolve(args.path) !== path.join(adapters, "core-client.cjs")) return { contents: raw, loader: args.path.endsWith(".json") ? "json" : "js" };
      const start = raw.indexOf('const Ajv = require("ajv/dist/2020");'), end = raw.indexOf("function validateBaseUrl");
      if (start < 0 || end < start) throw new Error("PR27 client prelude changed; do not patch an unreviewed source.");
      // Same Ajv schema/options, compiled at build time because Workers forbids eval.
      return { contents: raw.slice(0, start) + 'const validateHandoff = require("generated-risk-handoff-validator");\nconst { ConversationError } = require("./conversation-input.cjs");\nconst { extractCoreBinding } = require("./risk-callback.cjs");\n' + raw.slice(end), loader: "js", resolveDir: adapters };
    });
  } }] });
const config = `name = "finance-lab-risk-bridge"\nmain = "risk-worker.mjs"\ncompatibility_date = "2026-10-11"\ncompatibility_flags = ["nodejs_compat"]\nworkers_dev = true\n\n[vars]\nCORE_AGENT_BASE_URL = "https://finance-lab-core-risk-validation.realchenchenluo.workers.dev"\nRISK_REVIEWER_ID = "risk-conversation-cloudflare-v1"\nRISK_MODEL_CALLS_ENABLED = "false"\n\n[[durable_objects.bindings]]\nname = "RISK_CONVERSATIONS"\nclass_name = "RiskConversationService"\n\n[[migrations]]\ntag = "risk-conversation-v1"\nnew_sqlite_classes = ["RiskConversationService"]\n`;
await writeFile(path.join(output, "wrangler.toml"), config);
await writeFile(path.join(output, "source-manifest.json"), JSON.stringify({ risk_pr: 27, risk_source_commit: sourceCommit, pinned_source_files_verified: pinnedFiles, source_comparison: "Git text matches with CRLF normalized; raw file hashes retained", bundle_sha256: createHash("sha256").update(await readFile(path.join(output, "risk-worker.mjs"))).digest("hex"), transformations: ["Build-time Ajv standalone validator only; request/callback logic unchanged", "SQLite Durable Object store replaces local filesystem store"], owner_source_sha256: sourceHashes }, null, 2));
console.log(JSON.stringify({ output, files: Object.keys(sourceHashes).length, model_calls: 0, owner_files_modified: false }));
