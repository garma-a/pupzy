import bcrypt from 'bcryptjs';

const DUMMY_PASSWORD_HASH = '$2a$12$CYQdTb4/m9JaRQpxbhoGouaG0nrwg/PuwPTcoNXGhH9u9EK6Jptka';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildAuthenticate(pool, options = {}) {
  const clock = options.clock ?? (() => Date.now());
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const maxFailedAttempts = options.maxFailedAttempts ?? 5;
  const maxTrackedFailures = Math.max(1, options.maxTrackedFailures ?? 10_000);
  const failedAttempts = new Map();

  function makeRoomFor(attemptKey, now) {
    if (failedAttempts.has(attemptKey) || failedAttempts.size < maxTrackedFailures) return;
    for (const [key, value] of failedAttempts) {
      if (now - value.startedAt >= windowMs) failedAttempts.delete(key);
    }
    while (failedAttempts.size >= maxTrackedFailures) {
      failedAttempts.delete(failedAttempts.keys().next().value);
    }
  }

  return async function authenticate(email, password, context) {
    if (!email || !password) return null;

    const ip = context?.req?.ip ?? 'unknown';
    const normalizedEmail = String(email).toLowerCase().trim();
    if (normalizedEmail.length > 255 || !EMAIL_PATTERN.test(normalizedEmail)) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      options.onFailure?.({ ip, invalidIdentifier: true, blocked: false });
      return null;
    }
    const attemptKey = `${ip}\u0000${normalizedEmail}`;
    const now = clock();
    makeRoomFor(attemptKey, now);
    let attempt = failedAttempts.get(attemptKey);
    if (attempt && now - attempt.startedAt >= windowMs) {
      failedAttempts.delete(attemptKey);
      attempt = undefined;
    }
    if (attempt?.count >= maxFailedAttempts) {
      options.onFailure?.({
        ip,
        email: normalizedEmail,
        blocked: true,
        trackedFailures: failedAttempts.size,
      });
      return null;
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role, full_name, is_active
       FROM admin_users
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail],
    );
    const row = rows[0];
    const passwordMatches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row?.is_active || !passwordMatches) {
      makeRoomFor(attemptKey, clock());
      const currentAttempt = failedAttempts.get(attemptKey);
      failedAttempts.set(attemptKey, {
        count: (currentAttempt?.count ?? 0) + 1,
        startedAt: currentAttempt?.startedAt ?? now,
      });
      options.onFailure?.({
        ip,
        email: normalizedEmail,
        blocked: false,
        trackedFailures: failedAttempts.size,
      });
      return null;
    }
    failedAttempts.delete(attemptKey);

    if (typeof context?.req?.session?.regenerate !== 'function') {
      throw new Error('Admin session regeneration is unavailable.');
    }
    await new Promise((resolve, reject) => {
      context.req.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [row.id]);
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
    };
  };
}
