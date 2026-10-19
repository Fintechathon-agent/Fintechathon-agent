'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const repository = cp.execFileSync('git', ['rev-parse','--show-toplevel'], {cwd:__dirname,encoding:'utf8'}).trim();
const base = '922d8a34d54c862d0353b14bb3a01ceba67b2476';
const git = args => cp.execFileSync('git', args, {cwd:repository,maxBuffer:20*1024*1024});
const target = fs.mkdtempSync(path.join(os.tmpdir(),'tinglan-owner-candidate-'));
const entries = git(['ls-tree','-rz',base,'--','chenchen']).toString().split('\0').filter(Boolean);
for (const entry of entries) {
  const [meta,file] = entry.split('\t'); if (meta.split(' ')[1] !== 'blob' || /(?:^|\/)\.env/.test(file)) continue;
  const output = path.join(target,file); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,git(['cat-file','blob',meta.split(' ')[2]]));
}
const modulePath = path.join(target,'team-staging/ui/tinglan-ai-20261018');
fs.cpSync(__dirname,modulePath,{recursive:true,filter:source=>!source.includes('node_modules') && !source.includes('.env')});
const testSource = path.join(modulePath,'tests/gateway.test.mjs.source');
if (fs.existsSync(testSource)) fs.renameSync(testSource, path.join(modulePath,'tests/gateway.test.mjs'));
const provider = path.join(target,'chenchen/integrations/bailian-provider.js');
let source = fs.readFileSync(provider,'utf8');
const old = '!/^qwen3\\.7-flash(?:-\\d{4}-\\d{2}-\\d{2})?$/.test(model)';
if (!source.includes(old)) throw new Error('Owner baseline changed; review the model allowlist patch.');
source = source.replace(old, '!(model === "qwen3.8-flash" || /^qwen3\\.7-flash(?:-\\d{4}-\\d{2}-\\d{2})?$/.test(model))')
  .replace('This acceptance profile supports qwen3.7-flash and its dated snapshots only.', 'This acceptance profile supports verified qwen3.8-flash and qwen3.7-flash snapshots.');
fs.writeFileSync(provider,source);
const adapter = path.join(target,'chenchen/integrations/model-review.js');
source = fs.readFileSync(adapter,'utf8');
const anchor = '          }, availableMs);';
if (source.split(anchor).length !== 2) throw new Error('Owner baseline changed; review the model identity patch.');
source = source.replace(anchor, anchor + '\n          if (bailian && config.model === "qwen3.8-flash" && payload?.model !== config.model) {\n            throw new ReviewError("MODEL_INVALID_RESPONSE", "Provider model identity mismatch", { statusCode: 502 });\n          }');
fs.writeFileSync(adapter,source);
console.log(JSON.stringify({candidateRoot:target,modulePath,base,paidCalls:0,secretsCopied:false}));
