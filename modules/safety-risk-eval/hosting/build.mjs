import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../..");
const target = path.resolve(process.argv[2] || path.join(repo, "output/sites/risk-workbench"));
const sourceManifest = path.join(target, ".openai/hosting.json");
const manifest = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
if (!manifest.project_id) throw new Error("Persist the Site ID before building");
manifest.d1 = "DB"; manifest.r2 = null; delete manifest.static;
fs.writeFileSync(sourceManifest, JSON.stringify(manifest, null, 2));
const requireContract = createRequire(path.join(repo, "docs/safety-risk-eval/contracts/package.json"));
const Ajv = requireContract("ajv/dist/2020");
const formats = requireContract("ajv-formats");
const standalone = requireContract("ajv/dist/standalone").default;
const contractDir = path.join(repo, "docs/safety-risk-eval/contracts");
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false, strictNumbers: true, validateFormats: true, code: { source: true } });
formats(ajv); ajv.addSchema(json(path.join(repo, "chenchen/contracts/investment-agent.v1.schema.json")));
ajv.addSchema(json(path.join(contractDir, "common.schema.json")));
const ids = {};
for (const name of ["input", "output", "rule"]) { const schema = json(path.join(contractDir, `risk-${name}.schema.json`)); ajv.addSchema(schema); ids[name] = schema.$id; }
const generated = path.join(root, "generated"); fs.mkdirSync(generated, { recursive: true });
const handoffAjv = new Ajv({ allErrors: true, strict: false, strictNumbers: true, code: { source: true } });
formats(handoffAjv);
const handoffSchema = json(path.join(root, "../handoff/upstream.schema.json"));
handoffAjv.addSchema(handoffSchema);
fs.writeFileSync(path.join(generated, "handoff-validator.cjs"), standalone(handoffAjv, handoffAjv.compile({ $ref: `${handoffSchema.$id}#/$defs/HealthCheckResponse` })));
fs.writeFileSync(path.join(generated, "validators.cjs"), standalone(ajv, ids));
const dictionary = {};
for (const directory of ["", "rules", "examples"]) {
  for (const file of fs.readdirSync(path.join(contractDir, directory))) if (file.endsWith(".json")) dictionary[(directory ? directory + "/" : "") + file] = json(path.join(contractDir, directory, file));
}
const original = fs.readFileSync(path.join(contractDir, "validate.cjs"), "utf8");
const prefix = `"use strict";\nconst crypto = require("node:crypto");\nconst { isDeepStrictEqual } = require("node:util");\nconst values = ${JSON.stringify(dictionary)};\nconst read = (file) => structuredClone(values[file]);\nconst validators = require("./validators.cjs");\nconst ruleIds = Array.from({length:10},(_,i)=>\x60R\x24{String(i+1).padStart(2,"0")}\x60);\nconst rules = ruleIds.map(id=>read(\x60rules/\x24{id}.json\x60));\n`;
fs.writeFileSync(path.join(generated, "contract.cjs"), prefix + original.slice(original.indexOf("const canonical =")));
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const assets = {};
for (const file of ["index.html", "style.css", "app.js", "team-bootstrap.js", "daily.js", "daily.css"]) {
  let body = fs.readFileSync(path.join(root, "../public", file), "utf8");
  if (file === "index.html") body = body.replaceAll("本机", "在线").replace("日志存于在线，未接团队正式认证与集中审计。", "演示日志保存于云端D1，未接团队正式账号；请只输入虚构资料。");
  assets[file === "index.html" ? "/risk" : "/risk/" + file] = { body, type: mime[path.extname(file)] };
}
for (const file of ["style.css", "product-overrides.css", "investment.js", "common.js", "presentation.mjs"]) assets["/versions/" + file] = { body: fs.readFileSync(path.join(repo, "chenchen/versions", file), "utf8"), type: file.endsWith("css") ? mime[".css"] : mime[".js"] };
const investmentSource = fs.readFileSync(path.join(repo, "chenchen/versions/investment.html"), "utf8");
const merchantEntry = '<a class="back-link" href="/merchant">店主财务助手</a>';
if (!investmentSource.includes(merchantEntry)) throw new Error("Review the investment navigation before publishing: upstream markup changed");
// Scope the borrowed navigation to the two modules included in this deployment.
assets["/investment"] = { body: investmentSource.replace(merchantEntry, '<a class="back-link" href="/risk">风控工作台</a>').replace("</head>", '<script src="/risk/team-bootstrap.js"></script></head>'), type: mime[".html"] };
fs.mkdirSync(path.join(target, "dist/server"), { recursive: true });
await build({ entryPoints: [path.join(root, "worker.mjs")], outfile: path.join(target, "dist/server/index.js"), bundle: true, platform: "neutral", format: "esm", target: "es2022", external: ["node:crypto", "node:util"], banner: { js: 'import * as cloudCrypto from "node:crypto"; import * as cloudUtil from "node:util"; var require = (name) => { if(name === "node:crypto") return cloudCrypto; if(name === "node:util") return cloudUtil; throw new Error("Unbundled dependency"); };' }, nodePaths: [path.join(contractDir, "node_modules")], plugins: [{ name: "frozen-data-and-validators", setup(build) {
  build.onResolve({ filter: /^virtual:risk-assets$/ }, () => ({ path: "assets", namespace: "risk-assets" }));
  build.onLoad({ filter: /.*/, namespace: "risk-assets" }, () => ({ contents: `export default ${JSON.stringify(assets)}`, loader: "js" }));
  build.onLoad({ filter: /contracts[\\/]validate\.cjs$/ }, () => ({ contents: fs.readFileSync(path.join(generated, "contract.cjs"), "utf8"), loader: "js", resolveDir: generated }));
  build.onLoad({ filter: /handoff[\\/]validate\.cjs$/ }, () => ({ contents: fs.readFileSync(path.join(generated, "handoff-validator.cjs"), "utf8"), loader: "js", resolveDir: generated }));
  build.onLoad({ filter: /investment-contract\.js$/ }, ({ path: p }) => {
    let contents = fs.readFileSync(p, "utf8");
    contents = contents.replace('const fs = require("node:fs");', "").replace('const path = require("node:path");', "").replace(/const schema = JSON.parse\(fs.readFileSync\([^\n]+\);/, `const schema = ${JSON.stringify(json(path.join(repo, "chenchen/contracts/investment-agent.v1.schema.json")))};`);
    return { contents, loader: "js", resolveDir: path.dirname(p) };
  });
} }] });
fs.mkdirSync(path.join(target, "dist/.openai"), { recursive: true });
fs.writeFileSync(path.join(target, "dist/.openai/hosting.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(target, "dist/server/wrangler.json"), JSON.stringify({ name: "fund-risk-workbench", main: "index.js", compatibility_date: "2026-05-15", compatibility_flags: ["nodejs_compat"], d1_databases: [{ binding: "DB", database_name: "risk-demo-db", database_id: "local-risk-demo-db" }] }, null, 2));
fs.cpSync(path.join(root, "drizzle"), path.join(target, "drizzle"), { recursive: true });
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "fund-risk-online-artifact", private: true, type: "module" }, null, 2));
fs.writeFileSync(path.join(target, ".gitignore"), ".sites-runtime/\n.wrangler/\n");
console.log(JSON.stringify({ project_id: manifest.project_id, target, bytes: fs.statSync(path.join(target, "dist/server/index.js")).size }));
