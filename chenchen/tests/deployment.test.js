'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server } = require('../server');

test('public demo keeps origin checks, security headers and human-readable missing pages', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = process.env.PUBLIC_ACCESS;
  t.after(async () => {
    if(original===undefined) delete process.env.PUBLIC_ACCESS; else process.env.PUBLIC_ACCESS=original;
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  });
  const base = 'http://127.0.0.1:'+server.address().port;
  const missing = await fetch(base+'/missing-page');
  assert.equal(missing.status,404);
  assert.match(missing.headers.get('content-type'),/text\/html/);
  assert.match(await missing.text(),/回到投资工作台/);
  for(const route of ['/investment/','/merchant/','/catalog/']) assert.equal((await fetch(base+route)).status,200);
  const home = await fetch(base);
  assert.equal(home.headers.get('x-content-type-options'),'nosniff');
  assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const host = 'demo.example';
  const request = {method:'POST',headers:{Host:host,'Content-Type':'application/json',Origin:'https://demo.example'},body:'{}'};
  const proxyRequest = () => new Promise((resolve,reject) => {
    const outgoing=http.request(base+'/api/merchant/reset',request,response=>{
      response.resume(); response.on('end',()=>resolve(response.statusCode));
    });
    outgoing.on('error',reject); outgoing.end(request.body);
  });
  assert.equal(await proxyRequest(),403);
  process.env.PUBLIC_ACCESS='true';
  assert.equal(await proxyRequest(),200);
  request.headers.Origin='https://unrelated.example';
  assert.equal(await proxyRequest(),403);
  request.headers.Origin='null';
  assert.equal(await proxyRequest(),403);
  assert.equal((await fetch(base+'/api/paper-trade/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
});
