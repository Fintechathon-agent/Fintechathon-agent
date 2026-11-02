'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const info=JSON.parse(cp.execFileSync(process.execPath,[path.join(__dirname,'prepare.cjs')],{encoding:'utf8'}));
const publicRoot=path.join(info.modulePath,'public/investment-only');
for(const name of fs.readdirSync(publicRoot).filter(name=>name.endsWith('.html'))){
 const file=path.join(publicRoot,name),html=fs.readFileSync(file,'utf8');
 fs.writeFileSync(file,html.replaceAll('静态预览 · 虚构数据与浏览器模拟计算 · AI 后端未连接 · 不执行交易','持仓区为固定演示 · 听澜 AI 通过受保护入口调用 Qwen3.8 · 不执行交易'));
}
console.log(JSON.stringify(info));
