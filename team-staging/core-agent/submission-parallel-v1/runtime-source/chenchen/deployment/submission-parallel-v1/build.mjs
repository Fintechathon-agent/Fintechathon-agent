import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../integration/public-chat');
const output = path.join(here, 'dist/public');
mkdirSync(output, {recursive: true});
const hashes = {};
for (const [name, target] of [['app.html', 'index.html'], ['review.css', 'health.css'], ['review.js', 'health.js']]) {
  let text = readFileSync(path.join(source, name), 'utf8');
  hashes[name] = createHash('sha256').update(text).digest('hex');
  if (name === 'app.html') text = text.replace('<div id="scroll-area">', '<div id="scroll-area"><p class="submission-mode" role="status">__SUBMISSION_MODE__ · 仅分析与模拟</p>');
  if (name === 'review.css') text += '\n.submission-mode{margin:12px 16px;padding:10px;border:1px solid #dce5d7;border-radius:8px;font-size:12px;color:#45623d;background:#f6f9f2;overflow-wrap:anywhere}\n';
  if (name === 'review.js') text = text.replace('真实模型：', '模型回执：').replace('尚无完整模型回执', '尚无完整模型回执（演示模式不调用真实模型）');
  if (name === 'app.html' && /\bstyle\s*=|<style\b/i.test(text)) throw Error('INLINE_STYLE_BLOCKED');
  writeFileSync(path.join(output, target), text);
}
writeFileSync(path.join(here, 'dist/source-manifest.json'), JSON.stringify({module: 'submission-parallel-v1', source_files_sha256: hashes, original_sources_modified: false}, null, 2) + '\n');
console.log('Built isolated submission assets. Original source files were not changed.');
