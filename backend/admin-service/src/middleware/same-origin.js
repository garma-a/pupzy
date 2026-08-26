const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Defense in depth for cookie-authenticated AdminJS mutations. */
export function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return res.status(403).send('Forbidden');
  }

  const origin = req.get('origin');
  if (!origin) {
    if (fetchSite === 'same-origin') return next();
    return res.status(403).send('Forbidden');
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.host === req.get('host') && originUrl.protocol === `${req.protocol}:`) return next();
  } catch {
    // Invalid origins are rejected below.
  }
  return res.status(403).send('Forbidden');
}
