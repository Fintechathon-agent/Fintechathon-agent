'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const preview = path.resolve(process.argv[2]);
const moduleRoot = path.resolve(__dirname, '../../../team-staging/ui/tinglan-ai-20261018');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const changed = ['landing.html', 'investment-only/investment.html', 'investment-only/versions/investment.js', 'investment-only/versions/investment-theme.css'];
function refresh(file, assetRoot, modified) {
  const manifest = JSON.parse(fs.readFileSync(file));
  for (const entry of manifest.files) {
    if (!modified || modified.includes(entry.file)) entry.sha256 = digest(path.join(assetRoot, entry.file));
  }
  if (path.basename(file) === 'release-manifest.json' && !manifest.files.some(entry => entry.file === 'versions/investment-theme.css')) {
    manifest.files.push({ file: 'versions/investment-theme.css', sha256: digest(path.join(assetRoot, 'versions/investment-theme.css')) });
  }
  manifest.screenshotFollowup = { date: '2026-10-21', scope: 'THREE_TARGETED_UI_REPAIRS', backendChanged: false, modelCalls: 0 };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv.includes('--runtime-only')) {
  refresh(path.join(preview, 'release-manifest.json'), preview);
} else {
  refresh(path.join(preview, 'preview-manifest.json'), preview, ['landing.html']);
  refresh(path.join(preview, 'investment-only/release-manifest.json'), path.join(preview, 'investment-only'), ['investment.html', 'versions/investment.js']);
  refresh(path.join(moduleRoot, 'public/investment-only/release-manifest.json'), path.join(moduleRoot, 'public/investment-only'));
  changed.push('preview-manifest.json', 'investment-only/release-manifest.json');
  for (const file of changed) {
    const target = path.join(__dirname, 'site', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(preview, file), target);
  }
  fs.writeFileSync(path.join(__dirname, 'release-files.json'), JSON.stringify({ basePreviewCommit: 'c529294bf0fe78c205d9ef372ef75d6b5ead152e', files: changed.map(file => ({ file, sha256: digest(path.join(preview, file)) })) }, null, 2) + '\n');
}
