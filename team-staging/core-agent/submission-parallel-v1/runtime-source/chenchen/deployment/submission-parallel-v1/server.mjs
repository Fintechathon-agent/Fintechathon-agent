import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {timingSafeEqual, randomUUID} from 'node:crypto';
import {createRuntime} from './runtime.mjs';

const safeCode = code => /^[A-Z][A-Z0-9_]{0,80}$/.test(code || '') ? code : 'SERVICE_UNAVAILABLE';
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length >= 32 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createNodeServer(input, options = {}) {
  const runtime = await createRuntime(input, options);
  const hosts = new Map(runtime.origins.map(value => {const url = new URL(value); return [url.host, value];}));
  const logger = options.logger || (entry => console.log(JSON.stringify(entry)));
  const server = http.createServer(async (incoming, outgoing) => {
    const requestId = randomUUID(), started = Date.now();
    let route = 'unknown';
    try {
      const publicOrigin = hosts.get(incoming.headers.host);
      if (!publicOrigin) throw Object.assign(Error('WRONG_HOST'), {code: 'WRONG_HOST', status: 421});
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicOrigin).hostname);
      const proxy = sameSecret(incoming.headers['x-submission-proxy'], input.PROXY_SECRET);
      if (!local && (!proxy || incoming.headers['x-forwarded-proto'] !== 'https')) throw Object.assign(Error('HTTPS_PROXY_REQUIRED'), {code: 'HTTPS_PROXY_REQUIRED', status: 403});
      const url = new URL(incoming.url, publicOrigin);
      // Never accept a proxy-style absolute target to another host.
      if (url.origin !== publicOrigin) throw Object.assign(Error('WRONG_HOST'), {code: 'WRONG_HOST', status: 421});
      route = url.pathname.startsWith('/api/') ? '/api/[redacted]' : url.pathname === '/' ? '/' : '/[redacted]';
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (['cf-connecting-ip', 'x-verified-owner', 'x-verified-ip', 'x-submission-proxy', 'x-forwarded-for', 'x-forwarded-proto', 'connection', 'transfer-encoding', 'host'].includes(name) || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
      }
      const address = proxy ? String(incoming.headers['x-forwarded-for'] || '').split(',').at(-1).trim() : incoming.socket.remoteAddress || 'unknown';
      headers.set('CF-Connecting-IP', address);
      let body;
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        if (+incoming.headers['content-length'] > 16000) throw Object.assign(Error('BODY_TOO_LARGE'), {code: 'BODY_TOO_LARGE', status: 413});
        let size = 0; const chunks = [];
        for await (const chunk of incoming) {size += chunk.length; if (size > 16000) throw Object.assign(Error('BODY_TOO_LARGE'), {code: 'BODY_TOO_LARGE', status: 413}); chunks.push(chunk);}
        body = Buffer.concat(chunks);
      }
      const response = await runtime.fetch(new Request(url, {method: incoming.method, headers, ...(body ? {body} : {})}));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
      logger({request_id: requestId, route, status: response.status, duration_ms: Date.now() - started, model_mode: runtime.mode});
    } catch (error) {
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.writeHead(error.status || 503, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
        outgoing.end(JSON.stringify({error: {code: safeCode(error.code)}, execution_allowed: false}));
      }
      logger({request_id: requestId, route, status: error.status || 503, error_code: safeCode(error.code), duration_ms: Date.now() - started});
    }
  });
  server.requestTimeout = 200000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return {server, runtime, async close() {
    const closed = new Promise(resolve => server.close(resolve));
    await runtime.close(); server.closeAllConnections(); await closed;
  }};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const service = await createNodeServer(process.env);
    service.server.listen(Number(process.env.PORT || 4188), process.env.BIND_HOST || '127.0.0.1', () => console.log(JSON.stringify({event: 'listening',module: 'submission-parallel-v1',model_mode: service.runtime.mode,execution_allowed: false})));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {service.close().then(() => process.exit(0), () => process.exit(1));});
  } catch (error) {console.error(safeCode(error.code)); process.exitCode = 1;}
}
