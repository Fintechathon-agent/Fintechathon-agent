'use strict';
// Serve only this isolated design review, on loopback, without business routes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
function createServer() {
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const resource = files[new URL(request.url, 'http://127.0.0.1').pathname];
    if (!resource) { response.writeHead(404).end('Not found'); return; }
    fs.readFile(path.join(__dirname, resource[0]), (error, content) => {
      if (error) { response.writeHead(500).end('Read failed'); return; }
      response.writeHead(200, { 'Content-Type': resource[1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      response.end(request.method === 'HEAD' ? undefined : content);
    });
  });
}
if (require.main === module) {
  const port = Number(process.env.DIRECTION_PORT || 4188);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid DIRECTION_PORT');
  createServer().listen(port, '127.0.0.1', () => console.log(`Design review: http://127.0.0.1:${port}/`)).on('error', error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createServer };
