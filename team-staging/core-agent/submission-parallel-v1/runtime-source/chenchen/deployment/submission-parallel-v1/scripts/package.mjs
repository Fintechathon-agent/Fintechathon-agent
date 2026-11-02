import {mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(here, '../../..'), output = path.join(here, 'dist');
execFileSync(process.execPath, [path.join(here, 'build.mjs')], {stdio: 'inherit'});
const stage = mkdtempSync(path.join(os.tmpdir(), 'submission-package-'));
const collected = new Map();
function collect(filename) {
  const full = path.resolve(filename), relative = path.relative(repo, full).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('PACKAGE_PATH_OUTSIDE_REPO');
  if (collected.has(relative)) return;
  const content = readFileSync(full); collected.set(relative, createHash('sha256').update(content).digest('hex'));
  const target = path.join(stage, relative); mkdirSync(path.dirname(target), {recursive: true}); copyFileSync(full, target);
  if (!/\.(mjs|js)$/.test(full)) return;
  const pattern = /\b(?:from\s*|import\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  for (const match of content.toString('utf8').matchAll(pattern)) {
    const base = path.resolve(path.dirname(full), match[1]);
    const resolved = [base, base + '.js', base + '.mjs', base + '.json', path.join(base, 'index.js')].find(f => existsSync(f) && !f.endsWith(path.sep));
    if (!resolved) throw Error('UNRESOLVED_LOCAL_DEPENDENCY: ' + match[1]);
    collect(resolved);
  }
}
function moduleFiles(dir) {
  for (const item of readdirSync(dir, {withFileTypes: true})) {
    if (['dist', 'local', 'node_modules'].includes(item.name) || item.name === '.env' || item.name.startsWith('.env.') && item.name !== '.env.example') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) moduleFiles(full); else collect(full);
  }
}
moduleFiles(here);
for (const name of ['app.html', 'review.js', 'review.css', 'providers.env.example', 'providers.qwen.env.example']) collect(path.resolve(here, '../../integration/public-chat', name));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const manifest = JSON.stringify({source_commit: sourceCommit, module: 'submission-parallel-v1', files: Object.fromEntries(collected), contains_secrets: false, live_provider_tested: false}, null, 2) + '\n';
writeFileSync(path.join(stage, 'PACKAGE-MANIFEST.json'), manifest);
writeFileSync(path.join(output, 'package-manifest.json'), manifest);
const archive = path.join(output, 'finance-lab-submission-parallel-v1.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, '.']);
if (path.dirname(path.resolve(stage)).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(stage).startsWith('submission-package-')) throw Error('UNSAFE_PACKAGE_CLEANUP_PATH');
rmSync(stage, {recursive: true, force: true});
console.log('Deployment package: ' + archive);
console.log('Files: ' + collected.size + '; no private .env, database, logs or Git history included.');
