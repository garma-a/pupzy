import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { fork, ChildProcess } from 'child_process';
import { Pool } from 'pg';
import * as path from 'path';
import * as crypto from 'crypto';
import { runMigrations } from '../src/database/migrate';

jest.setTimeout(60_000);

async function pollHealthCheck(port: number, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        return (await res.json()) as Record<string, unknown>;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error(`Service on port ${port} did not report healthy within ${timeoutMs}ms`);
}

async function terminateProcess(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((resolve) => {
    proc.on('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

describe('Three-Service Production Artifact Smoke Tests', () => {
  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;
  let validTestPrivateKey: string;

  beforeAll(async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    validTestPrivateKey = privateKey;

    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_prod_smoke')
      .withUsername('test')
      .withPassword('test')
      .start();

    connectionString = container.getConnectionUri();
    pool = new Pool({ connectionString });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('proves the main API pre-deploy migration succeeds on clean database', async () => {
    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../drizzle/custom.sql'),
      }),
    ).resolves.not.toThrow();

    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tables = res.rows.map((r) => r.table_name);
    expect(tables).toContain('posts');
    expect(tables).toContain('users');
    expect(tables).toContain('admin_users');
    expect(tables).toContain('moderation_actions');
    expect(tables).toContain('admin_sessions');
  }, 30_000);

  it('proves the main API production artifact starts with documented contract and reports healthy without Redis', async () => {
    const apiPort = 3101;
    const apiEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(apiPort),
      DATABASE_URL: connectionString,
      DB_POOL_MAX: '10',
      PHONE_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      FIREBASE_PROJECT_ID: 'dummy-smoke-project',
      FIREBASE_CLIENT_EMAIL: 'smoke@dummy-smoke-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: validTestPrivateKey,
      R2_ACCOUNT_ID: 'dummy-smoke-r2',
      R2_ACCESS_KEY_ID: 'dummy-key',
      R2_SECRET_ACCESS_KEY: 'dummy-secret',
      R2_BUCKET_NAME: 'dummy-bucket',
      R2_PUBLIC_URL: 'https://pub-smoke.r2.dev',
    };
    delete (apiEnv as Record<string, string | undefined>).REDIS_URL;

    const apiProcess: ChildProcess = fork(path.resolve(__dirname, '../dist/src/main.js'), [], {
      cwd: path.resolve(__dirname, '..'),
      env: apiEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    try {
      const healthResponse = await pollHealthCheck(apiPort, 20_000);
      expect(healthResponse).toMatchObject({
        status: 'ok',
        info: {
          app: {
            status: 'up',
          },
        },
      });
    } finally {
      await terminateProcess(apiProcess);
    }
  }, 30_000);

  it('proves the AdminJS production artifact starts without REDIS_URL, reports healthy, and performs zero schema alterations', async () => {
    const adminPort = 4101;
    const adminEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(adminPort),
      DATABASE_URL: connectionString,
      ADMIN_COOKIE_PASSWORD: 'test-smoke-cookie-password-must-be-32-characters-minimum!',
      ADMIN_SESSION_SECRET: 'test-smoke-session-secret-must-be-32-characters-minimum!',
    };
    delete (adminEnv as Record<string, string | undefined>).REDIS_URL;

    const tablesBeforeRes = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tablesBefore = tablesBeforeRes.rows.map((r) => r.table_name);

    const adminProcess: ChildProcess = fork(path.resolve(__dirname, '../admin-service/src/main.js'), [], {
      cwd: path.resolve(__dirname, '../admin-service'),
      env: adminEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    try {
      const healthResponse = await pollHealthCheck(adminPort, 20_000);
      expect(healthResponse).toEqual({ ok: true });

      const tablesAfterRes = await pool.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const tablesAfter = tablesAfterRes.rows.map((r) => r.table_name);
      expect(tablesAfter).toEqual(tablesBefore);
    } finally {
      await terminateProcess(adminProcess);
    }
  }, 30_000);
});
