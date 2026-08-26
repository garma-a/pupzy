import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE_NAME = 'XSRF-TOKEN';

function sign(nonce, secret) {
  return crypto.createHmac('sha256', secret).update(nonce).digest('base64url');
}

function createToken(secret) {
  const nonce = crypto.randomBytes(32).toString('base64url');
  return `${nonce}.${sign(nonce, secret)}`;
}

function isValidToken(token, secret) {
  if (typeof token !== 'string') return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(nonce, secret);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Signed double-submit CSRF protection for cookie-authenticated AdminJS API calls. */
export function buildCsrfProtection(secret, { secure = false } = {}) {
  if (!secret) throw new Error('A CSRF signing secret is required.');

  return function csrfProtection(req, res, next) {
    const cookieToken = readCookie(req.get('cookie'), COOKIE_NAME);

    if (SAFE_METHODS.has(req.method)) {
      if (!isValidToken(cookieToken, secret)) {
        res.cookie(COOKIE_NAME, createToken(secret), {
          httpOnly: false,
          sameSite: 'lax',
          secure,
          path: '/admin',
        });
      }
      return next();
    }

    if (!/^\/api(?:\/|$)/.test(req.path)) return next();

    const headerToken = req.get('x-xsrf-token');
    if (
      !isValidToken(cookieToken, secret) ||
      typeof headerToken !== 'string' ||
      headerToken.length !== cookieToken.length ||
      !crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken))
    ) {
      return res.status(403).send('Forbidden');
    }
    return next();
  };
}
