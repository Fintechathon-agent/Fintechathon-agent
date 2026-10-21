const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const parse = value => JSON.parse(new TextDecoder().decode(decode(value)));
const cache = new Map();

export async function verifyAccess(request, env, fetchImpl = fetch, now = Date.now()) {
  const issuer = String(env.ACCESS_ISSUER || '').replace(/\/$/, '');
  const audience = String(env.ACCESS_AUD || '');
  const allowed = String(env.ACCESS_ALLOWED_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience || !allowed.length) throw new Error('ACCESS_NOT_CONFIGURED');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!token || token.length > 16000) throw new Error('AUTHENTICATION_REQUIRED');
  let header, claims, signature, unsigned;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    header = parse(parts[0]); claims = parse(parts[1]); signature = decode(parts[2]); unsigned = parts[0] + '.' + parts[1];
  } catch { throw new Error('AUTHENTICATION_REQUIRED'); }
  const seconds = now / 1000;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 ||
      claims.iss !== issuer || !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
      !Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 30 ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30)) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200 || claims.type !== 'app' ||
      typeof claims.email !== 'string' || !allowed.includes(claims.email.toLowerCase())) throw new Error('AUTHENTICATION_REQUIRED');
  let entry = cache.get(issuer);
  if (!entry || entry.expires < now) {
    const response = await fetchImpl(issuer + '/cdn-cgi/access/certs', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('AUTH_SERVICE_UNAVAILABLE');
    const body = await response.json();
    if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error('AUTH_SERVICE_UNAVAILABLE');
    entry = { keys: body.keys, expires: now + 60000 };
    if (cache.size >= 4) cache.clear();
    cache.set(issuer, entry);
  }
  const jwk = entry.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'));
  if (!jwk) throw new Error('AUTHENTICATION_REQUIRED');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(unsigned))) throw new Error('AUTHENTICATION_REQUIRED');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(issuer + ':' + claims.sub));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
