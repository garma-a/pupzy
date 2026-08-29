export function ipAllowlist(allowedIps) {
  const allowlist = new Set(allowedIps.filter(Boolean));
  return function checkIpAllowlist(req, res, next) {
    if (allowlist.has(req.ip)) return next();
    req.log?.warn({ ip: req.ip }, 'admin panel access blocked by IP allowlist');
    return res.status(403).send('Forbidden');
  };
}
