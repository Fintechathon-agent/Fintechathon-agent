'use strict';
// Local-only inspection server. Financial demo calculations run in the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'chenchen', 'dist-static');
const port = Number(process.env.REVIEW_PORT || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid REVIEW_PORT');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Run npm run build:static inside chenchen first');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'};
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  let base, relative;
  if (name === '/' || name === '/review/overnight-2026-10-07.html') { base=__dirname; relative='overnight-2026-10-07.html'; }
  else if (name === '/demo') { res.writeHead(302, {Location:'/demo/'}).end(); return; }
  else if (name.startsWith('/demo/')) { base=dist; relative=name.slice(6) || 'index.html'; }
  else if (/^\/screenshots\/[a-z0-9-]+\.png$/.test(name)) { base=path.join(root,'screenshots'); relative=name.slice(13); }
  else if (name === '/docs/investigation-return-vs-drawdown.md') { base=path.join(root,'docs'); relative='investigation-return-vs-drawdown.md'; }
  else if (name === '/favicon.ico') { base=dist; relative='versions/favicon.svg'; }
  else { res.writeHead(404).end('Not found'); return; }
  const file=path.resolve(base,relative), within=path.relative(base,file);
  if (within.startsWith('..') || path.isAbsolute(within)) { res.writeHead(404).end(); return; }
  fs.readFile(file,(error,data)=>{
    if(error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.listen(port,'127.0.0.1',()=>console.log('Finance Lab review: http://127.0.0.1:'+port+'/'));
server.on('error',error=>{ console.error(error.message); process.exitCode=1; });
