'use strict';
// Package only this task's reviewed frontend changes and refresh their manifests.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(process.argv[2]);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const publishedDigest = file => {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const bytes = files.includes(relative) ? fs.readFileSync(file) : cp.execFileSync('git', ['show', 'HEAD:' + relative], { cwd: root });
  return crypto.createHash('sha256').update(bytes).digest('hex');
};
const files = ['landing.html', 'workspace.html', 'catalog.html', 'investment.html', 'risk-workbench.html', 'investment-only/investment.html',
  'versions/workspace-refinement.css', 'versions/workspace.js', 'versions/workspace-investment.js', 'versions/archive.js', 'versions/landing.js'];
for (const name of files) {
  const file = path.join(root, name);
  let eol = '\n';
  try { if (cp.execFileSync('git', ['show', 'HEAD:' + name], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).includes(Buffer.from('\r\n'))) eol = '\r\n'; } catch { /* Newly introduced file uses LF. */ }
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, eol));
}
for (const name of ['preview-manifest.json', 'investment-only/release-manifest.json']) {
  const file = path.join(root, name), manifest = JSON.parse(fs.readFileSync(file));
  for (const entry of manifest.files) {
    const asset = path.resolve(path.dirname(file), entry.file);
    if (!fs.existsSync(asset)) throw new Error('Manifest references missing asset: ' + entry.file);
    entry.sha256 = publishedDigest(asset);
  }
  manifest.refinement = { date: '2026-10-21', basePreviewCommit: '57e0a6bccd890b00c8599d8bd64b62569fe3d196',
    teamBranch: 'codex/workspace-minimal-20261021', scope: 'UI_ONLY', backendChanged: false, logoChanged: false };
  if (name === 'preview-manifest.json') {
    if (!manifest.files.some(entry => entry.file === 'versions/workspace-refinement.css')) manifest.files.push({ file: 'versions/workspace-refinement.css', sha256: digest(path.join(root, 'versions/workspace-refinement.css')) });
  } else {
    manifest.refinement.sharedStylesheet = { file: '../versions/workspace-refinement.css', sha256: digest(path.join(root, 'versions/workspace-refinement.css')) };
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  files.push(name);
}
for (const name of files) {
  const target = path.join(__dirname, 'site', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, name), target);
}
fs.writeFileSync(path.join(__dirname, 'release-files.json'), JSON.stringify({
  basePreviewCommit: '57e0a6bccd890b00c8599d8bd64b62569fe3d196',
  files: files.map(file => ({ file, sha256: digest(path.join(root, file)) }))
}, null, 2) + '\n');
console.log(JSON.stringify({ reviewedFiles: files.length, backendChanged: false, logoChanged: false }));
