'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const eol=new Map(execFileSync('git',['ls-files','--eol'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).map(line=>{const [meta,file]=line.split('\t');return [file,meta.startsWith('i/lf')?'LF':'PRESERVE'];}));
const bytes=file=>eol.get(file)==='LF'?Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')):fs.readFileSync(path.join(root,file));
const hash=file=>crypto.createHash('sha256').update(bytes(file)).digest('hex');
const previewPath=path.join(root,'preview-manifest.json'),preview=JSON.parse(fs.readFileSync(previewPath,'utf8'));
for(const name of ['versions/workspace-adapter.mjs','versions/workspace-api.mjs'])if(!preview.files.some(f=>f.file===name))preview.files.push({file:name});
for(const entry of preview.files)if(fs.existsSync(path.join(root,entry.file)))entry.sha256=hash(entry.file);
preview.mode='ISOLATED_UI_CANDIDATE_NOT_DEPLOYED';
preview.candidate={date:'2026-10-27',uiBaseRepository:'lixjanus526-art/finance-lab-ui-preview',uiBaseBranch:'preview',uiBaseCommit:'ebd3a190f727d8060f12a9224b3e157084f7b43e',
  workBranch:'codex/p0p1-task-safety-20261027',teamBaseCommit:'fa53166cec9e3fb1ee4d720a31e3066bcc3f3c66',modelCalls:0,execution_allowed:false,publicPreviewUpdated:false};
fs.writeFileSync(previewPath,JSON.stringify(preview,null,2)+'\n');
const names=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
names.push('versions/workspace-adapter.mjs','versions/workspace-api.mjs');
const runtime=[...new Set(names)].filter(name=>!name.startsWith('evidence/')&&!name.startsWith('tests/')&&!name.startsWith('scripts/')&&/\.(html|css|m?js|json|png|svg|woff2?)$/.test(name)&&name!=='candidate-manifest.json'&&name!=='package.json').sort();
const manifest={version:'ui-candidate.v1',uiBaseCommit:preview.candidate.uiBaseCommit,teamBaseCommit:preview.candidate.teamBaseCommit,
  deployment:'NOT_DEPLOYED',formalJointAcceptance:'NOT_VERIFIED',modelCalls:0,execution_allowed:false,files:runtime.map(file=>({file,lineEndings:eol.get(file)||'PRESERVE',sha256:hash(file)}))};
fs.writeFileSync(path.join(root,'candidate-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Packaged runtime files:',runtime.length);
