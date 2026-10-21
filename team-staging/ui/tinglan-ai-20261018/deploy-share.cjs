'use strict';
// Only the user's independent account is allowed. Never print secret values.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
const args=process.argv.slice(2),option=name=>args.find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const mode=option('--mode'),root=option('--module-root'),cli=option('--wrangler');
if(!['secrets','enable','deploy'].includes(mode)||!root||!cli)throw new Error('Explicit mode, module root and Wrangler path required.');
const config=path.join(root,'wrangler.share.toml');let text=fs.readFileSync(config,'utf8');
if(!text.includes('account_id = "323563bd429155d1e603e8493138ada3"')||!text.includes('name = "xinlan-qwen38-share"'))throw new Error('Independent deployment target mismatch.');
const privateRoot=path.join(require('node:os').homedir(),'.codex/secrets/finance-lab-share');fs.mkdirSync(privateRoot,{recursive:true});
const privateFile=path.join(privateRoot,'server-auth.json');
const run=(command,input)=>{const result=cp.spawnSync(process.execPath,[cli,...command,'--config',config],{encoding:'utf8',input,env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:180000});
 let output=(result.stdout||'')+(result.stderr||'');
 if(input)for(const secret of Object.values(JSON.parse(input)))if(typeof secret==='string'&&secret)output=output.replaceAll(secret,'[REDACTED]');
 if(result.status!==0){console.error(output);process.exit(result.status||1);}console.log(output);};
if(mode==='secrets'){
 const local=parseEnv(fs.readFileSync(option('--server-env'),'utf8'));
 if(!local.MODEL_API_KEY||local.MODEL_NAME!=='qwen3.8-flash'||local.MODEL_API_URL!=='https://ws-h55unwqubcoxw7tb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')throw new Error('Unexpected server-only provider configuration.');
 if(!fs.existsSync(privateFile))fs.writeFileSync(privateFile,JSON.stringify({CORE_AGENT_API_KEY:crypto.randomBytes(32).toString('hex'),SHARE_ACCESS_CODE:crypto.randomBytes(24).toString('base64url'),SESSION_SIGNING_KEY:crypto.randomBytes(32).toString('hex')},null,2),{mode:0o600});
 const secrets={...JSON.parse(fs.readFileSync(privateFile,'utf8')),DASHSCOPE_API_KEY:local.MODEL_API_KEY};
 run(['secret','bulk'],JSON.stringify(secrets));
 console.log(JSON.stringify({secretsUploaded:true,privateAccessFile:privateFile,secretValuesPrinted:false}));
}else{
 if(mode==='enable'){
  if(option('--authorized-budget')!=='0.20')throw new Error('The user-authorized CNY 0.20 budget is required.');
  if(!fs.existsSync(privateFile))throw new Error('Configure secrets first.');
  text=text.replace('BAILIAN_ALLOW_PAID_CALLS = "false"','BAILIAN_ALLOW_PAID_CALLS = "true"');fs.writeFileSync(config,text);
 }
 run(['deploy']);
}
