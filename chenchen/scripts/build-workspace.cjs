"use strict";
// Produces a UI overlay for the existing Node server, not a standalone mock site.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "xinlan-ui-p0-"));
const files = ["investment.html","home.html","investment.js","common.js","presentation.mjs",
  "workspace.js","workspace-model.mjs","workspace.css","tokens.css","style.css","product-overrides.css","team-logo-transparent.png"];
const assets = [];
for (const name of files) {
  const content = fs.readFileSync(path.join(root, "versions", name));
  if (/\.m?js$/.test(name)) {
    const result = spawnSync(process.execPath, ["--input-type=module","--check"], {input:content});
    if (result.status !== 0) throw new Error("Invalid JavaScript: " + name);
  }
  if (/\.(html|css|m?js)$/.test(name) && /[\u2197\u27a1\u2714\u2705\u274c\ufe0f]/u.test(content.toString()))
    throw new Error("Emoji-prone glyph in " + name);
  fs.mkdirSync(path.join(output,"versions"), {recursive:true});
  fs.writeFileSync(path.join(output,"versions",name),content);
  assets.push({file:"versions/"+name,bytes:content.length,sha256:crypto.createHash("sha256").update(content).digest("hex")});
}
const manifest = {kind:"UI_OVERLAY_NOT_STANDALONE",runtime:"Existing chenchen Node server and static allowlist required; no API mocks included",assets};
fs.writeFileSync(path.join(output,"manifest.json"),JSON.stringify(manifest,null,2));
const evidence = path.resolve(root,"../review/ui-p0");
fs.mkdirSync(evidence,{recursive:true});
fs.writeFileSync(path.join(evidence,"asset-manifest.json"),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({output,assets:assets.length,apiMocks:false}));
