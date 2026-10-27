'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.name.startsWith('.')||['node_modules','evidence'].includes(e.name))continue;
  const file=path.join(dir,e.name);if(e.isDirectory()){scan(file);continue;}
  if(/\.(m?js|cjs)$/.test(e.name)){
    const args=file.includes(path.sep+'versions'+path.sep)?['--input-type=module','--check']:['--check',file];
    const r=spawnSync(process.execPath,args,{input:fs.readFileSync(file),encoding:'utf8'});
    if(r.status!==0){console.error(path.relative(root,file),r.stderr);process.exitCode=1;}count++;
  }
  if(file.includes(path.sep+'versions'+path.sep)&&/\.(html|css|m?js)$/.test(e.name)&&/[\u2197\u27a1\u2714\ufe0f\u{1f300}-\u{1faff}]/u.test(fs.readFileSync(file,'utf8'))){console.error('Unsupported emoji symbol:',path.relative(root,file));process.exitCode=1;}
}}
scan(root);console.log('Syntax and UI symbol checks:',count,'files');
