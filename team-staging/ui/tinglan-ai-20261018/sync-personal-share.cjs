'use strict';
// Update only the existing personal preview and its explicit live entry.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const target=path.resolve(process.argv[2]||'');
const git=args=>cp.execFileSync('git',args,{cwd:target,encoding:'utf8'}).trim();
if(git(['branch','--show-current'])!=='preview'||git(['remote','get-url','origin'])!=='https://github.com/lixjanus526-art/finance-lab-ui-preview.git'||git(['status','--porcelain']))throw new Error('Expected clean authorized personal preview checkout.');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'evidence/cloud-browser-final-20261020.json')));
if(evidence.result!=='REAL_CLOUD_BROWSER_CHAIN_PASSED')throw new Error('Real browser acceptance must pass before publishing a live entry.');
const root=path.join(target,'investment-only');
for(const [source,dest]of [['client.mjs','tinglan-client.mjs'],['widget.mjs','tinglan-widget.mjs']])fs.copyFileSync(path.join(__dirname,'frontend',source),path.join(root,'versions',dest));
const file=path.join(root,'investment.html');let html=fs.readFileSync(file,'utf8');
const section=/<section\b[^>]*id="ai-assistant"[\s\S]*?<\/section>/;
if(!section.test(html))throw new Error('Existing assistant section missing.');
const panel=fs.readFileSync(path.join(__dirname,'frontend/panel.html'),'utf8').replace('<form id="share-login"','<p id="tinglan-live-entry" class="small"><a href="https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment.html#ai-assistant" rel="noopener noreferrer">打开已验收的 Qwen3.8 真实分析网页</a>（需要分享访问口令）</p>\n<form id="share-login"');
fs.writeFileSync(file,html.replace(section,panel));
const manifest=path.join(root,'release-manifest.json'),data=JSON.parse(fs.readFileSync(manifest));
data.release='tinglan-protected-live-entry-2026-10-20';data.backend='STATIC_PREVIEW_WITH_PROTECTED_LIVE_LINK';data.realModelCalls=false;data.liveEntry=evidence.base+'/investment-only/investment.html#ai-assistant';data.liveAcceptance='REAL_CLOUD_BROWSER_CHAIN_PASSED';
const files=[];function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else if(p!==manifest)files.push({file:path.relative(root,p).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}}walk(root);data.files=files;fs.writeFileSync(manifest,JSON.stringify(data,null,2)+'\n');
console.log('Existing personal preview updated with a verified protected live entry; no credentials copied.');
