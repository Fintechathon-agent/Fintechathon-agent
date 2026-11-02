'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const hits=[];let scanned=0;
const rules=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['github-credential',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],['provider-credential',/\bsk-[A-Za-z0-9]{24,}\b/]];
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.name==='.git'||e.name==='node_modules')continue;
  const file=path.join(dir,e.name);if(e.isDirectory()){scan(file);continue;}
  if(/^\.env(?:\.|$)/.test(e.name)||/\.(pem|key|pfx|p12|dpapi)$/i.test(e.name)){hits.push({file:path.relative(root,file),rule:'forbidden-file-name'});continue;}
  if(!/\.(m?js|cjs|css|html|json|txt|md)$/.test(e.name))continue;
  scanned++;const source=fs.readFileSync(file,'utf8');for(const [rule,pattern] of rules)if(pattern.test(source))hits.push({file:path.relative(root,file),rule});
}}
scan(root);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'candidate-manifest.json'),'utf8'));const crypto=require('node:crypto');
for(const entry of manifest.files){let bytes=fs.readFileSync(path.join(root,entry.file));if(entry.lineEndings==='LF')bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));const digest=crypto.createHash('sha256').update(bytes).digest('hex');if(digest!==entry.sha256)hits.push({file:entry.file,rule:'manifest-hash-mismatch'});}
const report={scanned,credentialPatterns:rules.map(([rule])=>rule),hits,modelCalls:0,scope:'Tracked candidate text, forbidden filenames, runtime file integrity. This is not a penetration test.'};
fs.writeFileSync(path.join(root,'evidence/security.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(hits.length)process.exitCode=1;
