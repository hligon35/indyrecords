const assertionHeader = 'Cf-Access-Jwt-Assertion';
const cookieName = 'CF_Authorization';
const algorithm = 'RSASSA-PKCS1-v1_5';

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0));
}

function accessToken(headers) {
  // The edge assertion takes precedence, even if it fails verification.
  if (headers.has(assertionHeader)) return headers.get(assertionHeader);
  const cookies = (headers.get('Cookie') ?? '').split(';').map(cookie => cookie.trim());
  const matches = cookies.filter(cookie => cookie.startsWith(cookieName + '='));
  return matches.length === 1 ? matches[0].slice(cookieName.length + 1) : null;
}

export async function verifyAccess(request, env) {
  const issuer = env.ACCESS_ISSUER?.trim().replace(/\/$/, '');
  const audience = env.ACCESS_AUDIENCE?.trim();
  if (!audience || !issuer?.startsWith('https://') || URL.parse(issuer)?.origin !== issuer) {
    return { error: 'ACCESS_CONFIGURATION_REQUIRED', status: 503 };
  }

  const token = accessToken(request.headers);
  if (token === null) return { error: 'ACCESS_TOKEN_NOT_FORWARDED', status: 401 };
  const invalid = { error: 'ACCESS_TOKEN_INVALID_OR_EXPIRED', status: 401 };
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return invalid;

  let header, claims, signature;
  try {
    const decoder = new TextDecoder();
    header = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
    signature = decodeBase64Url(parts[2]);
  } catch {
    return invalid;
  }
  const now = Date.now() / 1000;
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid ||
      claims?.iss !== issuer ||
      !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience) ||
      typeof claims.sub !== 'string' || !claims.sub ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
      ('nbf' in claims && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60))) return invalid;

  let keys;
  const unavailable = { error: 'ACCESS_VERIFICATION_UNAVAILABLE', status: 503 };
  try {
    const res = await fetch(issuer + '/cdn-cgi/access/certs', { redirect: 'error' });
    if (!res.ok) return unavailable;
    ({ keys } = await res.json());
    if (!Array.isArray(keys)) return unavailable;
  } catch {
    return unavailable;
  }
  const key = keys.find(key => key?.kid === header.kid && key.kty === 'RSA');
  if (!key) return invalid;
  try {
    const publicKey = await crypto.subtle.importKey('jwk', key, { name: algorithm, hash: 'SHA-256' }, false, ['verify']);
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    return await crypto.subtle.verify(algorithm, publicKey, signature, data) ? { sub: claims.sub } : invalid;
  } catch {
    return invalid;
  }
}
