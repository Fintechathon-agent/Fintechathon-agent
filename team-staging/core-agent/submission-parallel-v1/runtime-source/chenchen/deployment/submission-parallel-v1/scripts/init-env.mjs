import {existsSync, writeFileSync, readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
const publicOrigin = value('--origin'), mode = args.includes('--mode') ? value('--mode') : 'disabled';
if (!args.includes('--origin') || !['disabled', 'demo'].includes(mode)) throw Error('Usage: node scripts/init-env.mjs --origin https://app.YOUR-DOMAIN.cn --mode disabled|demo');
const url = new URL(publicOrigin);
if (url.origin !== publicOrigin || url.protocol !== 'https:') throw Error('Use an exact HTTPS origin without a path.');
if (existsSync(path.join(here, '.env'))) throw Error('ENV_EXISTS: existing secrets and budget configuration were not overwritten.');
let text = readFileSync(path.join(here, '.env.example'), 'utf8')
  .replace('https://app.YOUR-DOMAIN.cn', url.origin).replace('PUBLIC_HOSTS=app.YOUR-DOMAIN.cn', 'PUBLIC_HOSTS=' + url.hostname)
  .replace('SUBMISSION_MODEL_MODE=disabled', 'SUBMISSION_MODEL_MODE=' + mode).replace('/data/disabled.sqlite', '/data/' + mode + '.sqlite');
for (const name of ['SESSION_SECRET', 'RISK_HMAC_SECRET', 'PROXY_SECRET']) text = text.replace(new RegExp('^' + name + '=.*$', 'm'), name + '=' + randomBytes(32).toString('hex'));
writeFileSync(path.join(here, '.env'), text, {mode: 0o600, flag: 'wx'});
console.log('Private .env created. Secrets were not printed. Model mode: ' + mode);
