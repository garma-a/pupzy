import bcrypt from "bcryptjs";

export function buildAuthenticate(pool) {
  return async function authenticate(email, password) {
    if (!email || !password) return null;

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role, full_name, is_active
       FROM admin_users
       WHERE email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()],
    );
    const row = rows[0];
    if (!row?.is_active) return null;
    if (!(await bcrypt.compare(password, row.password_hash))) return null;

    await pool.query(
      "UPDATE admin_users SET last_login_at = now() WHERE id = $1",
      [row.id],
    );
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
    };
  };
}
