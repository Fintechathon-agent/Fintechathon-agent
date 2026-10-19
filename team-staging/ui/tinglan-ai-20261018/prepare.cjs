'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const repository = cp.execFileSync('git', ['rev-parse','--show-toplevel'], {cwd:__dirname,encoding:'utf8'}).trim();
const base = '922d8a34d54c862d0353b14bb3a01ceba67b2476';
const git = args => cp.execFileSync('git', args, {cwd:repository,maxBuffer:20*1024*1024});
const target = fs.mkdtempSync(path.join(os.tmpdir(),'tinglan-owner-candidate-'));
const entries = git(['ls-tree','-rz',base,'--','chenchen']).toString().split('\0').filter(Boolean).map(entry => {
  const [meta,file] = entry.split('\t'); return { type:meta.split(' ')[1],sha:meta.split(' ')[2],file };
}).filter(entry => entry.type === 'blob' && !/(?:^|\/)\.env/.test(entry.file));
// Batch blob reads avoid one Windows process launch for every source file.
const blobs = cp.execFileSync('git',['cat-file','--batch'],{cwd:repository,input:entries.map(entry=>entry.sha).join('\n')+'\n',maxBuffer:128*1024*1024});
let offset = 0;
for (const entry of entries) {
  const newline = blobs.indexOf(10,offset), header = blobs.subarray(offset,newline).toString().split(' '), size = Number(header[2]);
  if (header[0] !== entry.sha || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git batch response.');
  offset = newline + 1;
  const output = path.resolve(target,entry.file);
  if (!output.startsWith(path.resolve(target)+path.sep)) throw new Error('Invalid source path.');
  fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,blobs.subarray(offset,offset+size));
  offset += size + 1;
}
const modulePath = path.join(target,'team-staging/ui/tinglan-ai-20261018');
fs.cpSync(__dirname,modulePath,{recursive:true,filter:source=>!source.includes('node_modules') && !source.includes('.env')});
const testSource = path.join(modulePath,'tests/gateway.test.mjs.source');
if (fs.existsSync(testSource)) fs.renameSync(testSource, path.join(modulePath,'tests/gateway.test.mjs'));
const provider = path.join(target,'chenchen/integrations/bailian-provider.js');
let source = fs.readFileSync(provider,'utf8');
const old = '!/^qwen3\\.7-flash(?:-\\d{4}-\\d{2}-\\d{2})?$/.test(model)';
if (!source.includes(old)) throw new Error('Owner baseline changed; review the model allowlist patch.');
source = source.replace(old, '!(["qwen3.8-flash", "qwen3.8-max"].includes(model) || /^qwen3\\.7-flash(?:-\\d{4}-\\d{2}-\\d{2})?$/.test(model))')
  .replace('This acceptance profile supports qwen3.7-flash and its dated snapshots only.', 'This candidate supports explicit Qwen3.8 models and legacy qwen3.7-flash machine callers; no model fallback.');
fs.writeFileSync(provider,source);
// Explicit Max selection reserves more before HTTP; Flash retains its old cap.
const budgetPath = path.join(target,'chenchen/integrations/bailian-budget.js');
let budget = fs.readFileSync(budgetPath,'utf8');
if (budget.split('budget.reserved_cents + 1').length !== 3 || !budget.includes('const limit = Number(this.env.BAILIAN_TEST_BUDGET_CNY || 0);')) throw new Error('Owner baseline changed; review model-specific reservations.');
budget = budget.replace('const limit = Number(this.env.BAILIAN_TEST_BUDGET_CNY || 0);', 'const limit = Number(this.env.BAILIAN_TEST_BUDGET_CNY || 0);\n      const reservedCents = model === "qwen3.8-max" ? 50 : 1;')
  .replaceAll('budget.reserved_cents + 1','budget.reserved_cents + reservedCents')
  .replace('reserved_cny: RESERVATION_CNY_PER_ATTEMPT','reserved_cny: reservedCents / 100');
fs.writeFileSync(budgetPath,budget);
const adapter = path.join(target,'chenchen/integrations/model-review.js');
source = fs.readFileSync(adapter,'utf8');
const anchor = '          }, availableMs);';
if (source.split(anchor).length !== 2) throw new Error('Owner baseline changed; review the model identity patch.');
source = source.replace(anchor, anchor + '\n          if (bailian && ["qwen3.8-flash", "qwen3.8-max"].includes(config.model) && payload?.model !== config.model) {\n            throw new ReviewError("MODEL_INVALID_RESPONSE", "Provider model identity mismatch", { statusCode: 502 });\n          }');
fs.writeFileSync(adapter,source);
console.log(JSON.stringify({candidateRoot:target,modulePath,base,paidCalls:0,secretsCopied:false}));
