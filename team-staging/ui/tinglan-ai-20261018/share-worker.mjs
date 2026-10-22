import core from '../../../chenchen/deployment/worker.js';
import { ReviewService } from './worker-entry.mjs';
import { createGateway, failure } from './gateway.mjs';
import { ShareAuth, verifySession, issueSession, sessionCookie, digest } from './share-auth.mjs';
export { ReviewService, ShareAuth };
const gateway = createGateway(core, verifySession);
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  const publicAccess = env.SHARE_ACCESS_MODE === 'PUBLIC';
  if (url.pathname === '/') return Response.redirect(url.origin + '/investment-only/investment.html#ai-assistant', 302);
  if (url.pathname === '/health') return json({ status: 'ok', service: 'xinlan-qwen38-share', model: env.MODEL_NAME, configured: Boolean(env.DASHSCOPE_API_KEY && env.CORE_AGENT_API_KEY && env.SHARE_ACCESS_CODE && env.SESSION_SIGNING_KEY), paidEnabled: env.BAILIAN_ALLOW_PAID_CALLS === 'true', accessMode: publicAccess ? 'PUBLIC' : 'CODE' });
  if (url.pathname === '/api/session') {
    if (request.method === 'GET') {
      if (publicAccess) {
        const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
        if ((origin && origin !== url.origin) || site === 'cross-site') return failure('ORIGIN_DENIED', 403);
        try {
          try { await verifySession(request, env); return json({ authenticated: true, model: env.MODEL_NAME }); }
          catch { /* Create a signed session without exposing any server secret. */ }
          return json({ authenticated: true, model: env.MODEL_NAME }, 200, { 'Set-Cookie': sessionCookie(await issueSession(env)) });
        } catch { return failure('ACCESS_NOT_CONFIGURED', 503); }
      }
      try { await verifySession(request, env); return json({ authenticated: true, model: env.MODEL_NAME }); }
      catch { return json({ authenticated: false }, 401); }
    }
    if (!['POST','DELETE'].includes(request.method)) return failure('METHOD_NOT_ALLOWED', 405);
    if (request.headers.get('Origin') !== url.origin) return failure('ORIGIN_DENIED', 403);
    if (request.method === 'DELETE') return json({ authenticated: false }, 200, { 'Set-Cookie': '__Host-xinlan_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return failure('INVALID_JSON', 400);
    let body;
    try {
      const reader = request.body?.getReader(); if (!reader) return failure('INVALID_JSON', 400);
      const chunks = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024) { await reader.cancel(); return failure('INVALID_REVIEW_INPUT', 413); } chunks.push(part.value); }
      const merged = new Uint8Array(size); let offset = 0; for (const part of chunks) { merged.set(part, offset); offset += part.length; }
      body = JSON.parse(new TextDecoder().decode(merged));
    } catch { return failure('INVALID_JSON', 400); }
    if (typeof body.code !== 'string' || body.code.length < 16 || body.code.length > 128) return json({ error: 'AUTHENTICATION_REQUIRED' }, 401);
    try {
      const ipHash = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
      const auth = env.SHARE_AUTH.get(env.SHARE_AUTH.idFromName('share-login-v1'));
      return await auth.fetch(new Request('https://internal/login', { method: 'POST', body: JSON.stringify({ code: body.code, ipHash }) }));
    } catch { return failure('SERVICE_UNAVAILABLE', 503); }
  }
  if (url.pathname === '/investment-only/tinglan-config.json') return json({ endpoint: '/api/review', model: env.MODEL_NAME, mode: 'SESSION', accessMode: publicAccess ? 'PUBLIC' : 'CODE' });
  if (url.pathname === '/api/tinglan/status' && request.method === 'GET') {
    try { await verifySession(request,env); } catch { return failure('AUTHENTICATION_REQUIRED',401); }
    try {
      const service=env.REVIEW_SERVICE.get(env.REVIEW_SERVICE.idFromName('team-review-v1'));
      return await service.fetch(new Request('https://internal/_tinglan/usage',{headers:{'X-Core-Agent-Key':env.CORE_AGENT_API_KEY}}));
    } catch { return failure('SERVICE_UNAVAILABLE',503); }
  }
  if (url.pathname.startsWith('/investment-only/') && env.ASSETS) {
    const response = await env.ASSETS.fetch(request); const headers = new Headers(response.headers);
    headers.set('Referrer-Policy','no-referrer'); headers.set('X-Content-Type-Options','nosniff');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  }
  if (!['/api/review','/api/tinglan/status'].includes(url.pathname)) return failure('METHOD_NOT_ALLOWED',404);
  if (env.MODEL_PROVIDER !== 'aliyun_bailian' || env.MODEL_NAME !== 'qwen3.8-flash') return failure('MODEL_NOT_CONFIGURED',503);
  // Public share access cannot use the machine-credential bypass or workflow writes.
  const headers = new Headers(request.headers); headers.delete('X-Core-Agent-Key');
  return gateway.fetch(new Request(request, { headers }), env, ctx);
} };
