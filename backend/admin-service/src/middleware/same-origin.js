const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Defense in depth for cookie-authenticated AdminJS mutations. */
export function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return res.status(403).send("Forbidden");
  }

  const origin = req.get("origin");
  if (!origin) {
    if (["same-origin", "same-site"].includes(fetchSite)) return next();
    return res.status(403).send("Forbidden");
  }

  try {
    if (new URL(origin).host === req.get("host")) return next();
  } catch {
    // Invalid origins are rejected below.
  }
  return res.status(403).send("Forbidden");
}
