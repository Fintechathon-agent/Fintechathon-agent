'use strict';
// Extract immutable Owner code into ignored runtime storage without editing it.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repository=cp.execFileSync('git',['-c','core.commitGraph=false','rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim();
const ref='46041e5526f97c0956798315d5caceb653615208';
const target=path.join(__dirname,'runtime/core');
const entries=cp.execFileSync('git',['-c','core.commitGraph=false','ls-tree','-rz',ref,'--','chenchen'],{cwd:repository}).toString().split('\0').filter(Boolean).map(row=>{const [meta,file]=row.split('\t');return{type:meta.split(' ')[1],sha:meta.split(' ')[2],file};}).filter(e=>e.type==='blob'&&(/^chenchen\/(?:core|tools|contracts|integrations|data|merchant)\/[^/]+\.(?:js|json)$/.test(e.file)||e.file==='chenchen/server.js'));
const blobs=cp.execFileSync('git',['-c','core.commitGraph=false','cat-file','--batch'],{cwd:repository,input:entries.map(e=>e.sha).join('\n')+'\n',maxBuffer:128*1024*1024});
let offset=0;
for(const entry of entries){const end=blobs.indexOf(10,offset),header=blobs.subarray(offset,end).toString().split(' '),size=Number(header[2]);if(header[0]!==entry.sha||!Number.isSafeInteger(size))throw new Error('Invalid source object');offset=end+1;const dest=path.join(target,entry.file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,blobs.subarray(offset,offset+size));offset+=size+1;}
console.log(JSON.stringify({ref,files:entries.length,root:target}));
