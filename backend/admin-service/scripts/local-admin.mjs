// One-command LOCAL admin environment: PostGIS container + migrations + demo data + media server + admin service.
//   npm run local:admin            start (creates/starts container, migrates+seeds on first run)
//   npm run local:admin -- --reset drop everything and reseed
// Local only. Never point this at a real database.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './local/migrate.mjs';
import { LOCAL_LOGINS, seed } from './local/seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, '..');
const mediaRoot = path.join(here, 'local', 'media');
const CONTAINER = process.env.LOCAL_ADMIN_CONTAINER ?? 'pupzy-admin-local';
const DB_PORT = Number(process.env.LOCAL_ADMIN_DB_PORT ?? 55432);
const PUBLIC_PORT = Number(process.env.LOCAL_ADMIN_PORT ?? 4000); // media + proxy (same origin keeps CSP img-src 'self')
const ADMIN_PORT = PUBLIC_PORT + 1; // the real admin service
const DATABASE_URL = `postgres://pupzy:pupzy@127.0.0.1:${DB_PORT}/pupzy_admin_local`;
const reset = process.argv.includes('--reset');

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

function ensureContainer() {
  const state = docker('inspect', '-f', '{{.State.Running}}', CONTAINER);
  if (state.status !== 0) {
    const run = docker('run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_USER=pupzy', '-e', 'POSTGRES_PASSWORD=pupzy',
      '-e', 'POSTGRES_DB=pupzy_admin_local', '-p', `127.0.0.1:${DB_PORT}:5432`, 'postgis/postgis:16-3.4-alpine');
    if (run.status !== 0) throw new Error(run.stderr);
  } else if (state.stdout.trim() !== 'true') {
    docker('start', CONTAINER);
  }
}

async function waitForDb() {
  for (let i = 0; i < 60; i += 1) {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    try { await pool.query('SELECT 1'); await pool.end(); return; } catch { await pool.end().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Postgres did not become ready');
}

ensureContainer();
await waitForDb();

const mediaBase = `http://localhost:${PUBLIC_PORT}/local-media`;
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
if (reset) await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
const hasSchema = (await pool.query(`SELECT to_regclass('public.admin_users') AS t`)).rows[0].t;
if (!hasSchema) {
  console.log('Applying migrations...');
  await migrate(DATABASE_URL);
}
if ((await pool.query('SELECT count(*)::int AS n FROM admin_users')).rows[0].n === 0) {
  console.log('Seeding demo data...');
  await seed(pool, mediaBase);
}
await pool.end();

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(ADMIN_PORT),
  DATABASE_URL,
  ADMIN_COOKIE_PASSWORD: 'local-only-cookie-password-0123456789abcdef',
  ADMIN_SESSION_SECRET: 'local-only-session-secret-0123456789abcdef',
  NOMINATIM_ENABLED: 'false',
  COMMENT_MEDIA_CDN_BASE: mediaBase,
};
const child = spawn(process.execPath, ['src/main.js'], { cwd: serviceRoot, env, stdio: 'inherit' });

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
http.createServer((req, res) => {
  if (req.url.startsWith('/local-media/')) {
    // Storage keys are unique per row (posts/<id>/photoN.jpg), so resolve to the sample file by directory + basename.
    const rel = path.normalize(decodeURIComponent(req.url.slice('/local-media/'.length).split('?')[0]));
    const file = path.join(mediaRoot, rel.split(path.sep)[0], path.basename(rel));
    if (!file.startsWith(mediaRoot) || !fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const upstream = http.request({ host: '127.0.0.1', port: ADMIN_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  upstream.on('error', () => res.writeHead(502).end('admin service not ready'));
  req.pipe(upstream);
}).listen(PUBLIC_PORT, '127.0.0.1', () => {
  console.log(`\nLocal admin: http://localhost:${PUBLIC_PORT}/admin  (container ${CONTAINER}, db port ${DB_PORT})`);
  for (const a of Object.values(LOCAL_LOGINS)) console.log(`  ${a.role.padEnd(11)} ${a.email} / ${a.password}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); process.exit(0); });
child.on('exit', (code) => process.exit(code ?? 0));
