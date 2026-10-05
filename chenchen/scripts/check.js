"use strict";
const fs=require('node:fs'), path=require('node:path'), {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function check(directory){for(const file of fs.readdirSync(directory,{withFileTypes:true})){
  const full=path.join(directory,file.name);
  if(file.isDirectory()&&!['node_modules','.git'].includes(file.name))check(full);
  else if(file.isFile()&&/\.m?js$/.test(file.name)){
    const args=full.includes(path.sep+'versions'+path.sep)?['--input-type=module','--check']:['--check',full];
    const result=spawnSync(process.execPath,args,{input:fs.readFileSync(full),encoding:'utf8'});
    if(result.status!==0){console.error(full,result.stderr);process.exitCode=1;}
  }
}}
check(root);if(!process.exitCode)console.log('JavaScript syntax checks passed.');
