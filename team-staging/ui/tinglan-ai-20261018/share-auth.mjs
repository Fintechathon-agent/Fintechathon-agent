const encode = value => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const bytes = value => new TextEncoder().encode(value);
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value))), x => x.toString(16).padStart(2, '0')).join('');
const signingKey = env => crypto.subtle.importKey('raw', bytes(env.SESSION_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function issueSession(env, now = Date.now()) {
  if (!env.SHARE_ACCESS_CODE || !env.SESSION_SIGNING_KEY) throw new Error('ACCESS_NOT_CONFIGURED');
  const payload = encode(bytes(JSON.stringify({ sub: await digest(env.SHARE_ACCESS_CODE), exp: Math.floor(now / 1000) + 8 * 3600, nonce: crypto.randomUUID() })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), bytes(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}
export async function verifySession(request, env, now = Date.now()) {
  if (!env.SHARE_ACCESS_CODE || !env.SESSION_SIGNING_KEY) throw new Error('ACCESS_NOT_CONFIGURED');
  try {
    const token = /(?:^|;\s*)__Host-xinlan_session=([^;]+)/.exec(request.headers.get('Cookie') || '')?.[1];
    if (!token || token.length > 2048) throw new Error();
    const parts = token.split('.'); if (parts.length !== 2) throw new Error();
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), decode(parts[1]), bytes(parts[0]))) throw new Error();
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= now / 1000 || payload.exp > now / 1000 + 8 * 3600 + 30 || payload.sub !== await digest(env.SHARE_ACCESS_CODE)) throw new Error();
    return payload.sub;
  } catch { throw new Error('AUTHENTICATION_REQUIRED'); }
}
export const sessionCookie = token => '__Host-xinlan_session=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800';
export class ShareAuth {
  constructor(state, env) { this.storage = state.storage; this.env = env; this.queue = Promise.resolve(); this.pending = 0; }
  fetch(request) {
    if (this.pending >= 32) return Promise.resolve(Response.json({ error: 'RATE_LIMITED' }, { status: 429 }));
    this.pending++;
    const result = this.queue.then(() => this.handle(request)).finally(() => { this.pending--; });
    this.queue = result.catch(() => {}); return result;
  }
  async handle(request) {
    try {
      if (!this.env.SHARE_ACCESS_CODE || !this.env.SESSION_SIGNING_KEY) return Response.json({ error: 'ACCESS_NOT_CONFIGURED' }, { status: 503 });
      const body = await request.json();
      if (typeof body.code !== 'string' || body.code.length > 128 || !/^[a-f0-9]{64}$/.test(body.ipHash || '')) return Response.json({ error: 'INVALID_INPUT' }, { status: 422 });
      const minute = Math.floor(Date.now() / 60000), window = Math.floor(Date.now() / 600000);
      const global = await this.storage.get('global-login') || { minute: 0, count: 0 };
      const old = await this.storage.get('ip:' + body.ipHash) || { window: 0, count: 0 };
      const count = old.window === window ? old.count : 0, total = global.minute === minute ? global.count : 0;
      if (count >= 5 || total >= 100) return Response.json({ error: 'RATE_LIMITED' }, { status: 429 });
      await this.storage.put({ ['ip:' + body.ipHash]: { window, count: count + 1 }, 'global-login': { minute, count: total + 1 } });
      if (await digest(body.code) !== await digest(this.env.SHARE_ACCESS_CODE)) return Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': sessionCookie(await issueSession(this.env)), 'Cache-Control': 'no-store' } });
    } catch { return Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }); }
  }
}
