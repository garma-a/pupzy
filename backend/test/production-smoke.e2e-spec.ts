import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as net from 'net';
import { Pool } from 'pg';

jest.setTimeout(600_000);

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface RunningImage {
  process: ChildProcess;
  output: () => string;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function pollHealthCheck(
  port: number,
  running: RunningImage,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      if (running.process.exitCode !== null) {
        throw new Error(`Container exited ${running.process.exitCode}\n${running.output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`Service on port ${port} did not report healthy within ${timeoutMs}ms`);
}

function startImage(
  rootDir: string,
  image: string,
  name: string,
  hostPort: number,
  containerPort: number,
  environment: Record<string, string>,
): RunningImage {
  const envArgs = Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const process = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      name,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-p',
      `${hostPort}:${containerPort}`,
      ...envArgs,
      image,
    ],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { process, output: () => output };
}

describe('Three-Service Production Container Smoke Tests', () => {
  const rootDir = process.cwd();
  const apiImage = `pupzy-api-smoke:${process.pid}`;
  const adminImage = `pupzy-admin-smoke:${process.pid}`;
  const apiName = `pupzy-api-smoke-${process.pid}`;
  const adminName = `pupzy-admin-smoke-${process.pid}`;
  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let containerDatabaseUrl: string;
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
    const dockerUrl = new URL(connectionString);
    dockerUrl.hostname = 'host.docker.internal';
    containerDatabaseUrl = dockerUrl.toString();
    pool = new Pool({ connectionString });

    await Promise.all([
      runCommand('docker', ['build', '--pull=false', '-t', apiImage, '.'], rootDir),
      runCommand('docker', ['build', '--pull=false', '-t', adminImage, '.'], `${rootDir}/admin-service`),
    ]);
  }, 600_000);

  afterAll(async () => {
    await Promise.allSettled([
      runCommand('docker', ['stop', '-t', '3', apiName], rootDir),
      runCommand('docker', ['stop', '-t', '3', adminName], rootDir),
    ]);
    if (pool) await pool.end();
    if (container) await container.stop();
    await Promise.allSettled([
      runCommand('docker', ['image', 'rm', apiImage], rootDir),
      runCommand('docker', ['image', 'rm', adminImage], rootDir),
    ]);
  });

  it('executes the exact packaged pre-deploy CLI successfully on a clean database', async () => {
    await expect(
      runCommand(
        'docker',
        [
          'run',
          '--rm',
          '--add-host',
          'host.docker.internal:host-gateway',
          '-e',
          `DATABASE_URL=${containerDatabaseUrl}`,
          apiImage,
          'node',
          'dist/database/migrate.js',
        ],
        rootDir,
      ),
    ).resolves.toMatchObject({ stderr: '' });

    const tables = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining(['posts', 'users', 'admin_users', 'moderation_actions', 'admin_sessions']),
    );
  });

  it('starts the real main API image and reports healthy without Redis', async () => {
    const apiPort = await freePort();
    const apiProcess = startImage(rootDir, apiImage, apiName, apiPort, 3000, {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: containerDatabaseUrl,
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
    });

    try {
      await expect(pollHealthCheck(apiPort, apiProcess)).resolves.toMatchObject({
        status: 'ok',
        info: { app: { status: 'up' } },
      });
    } finally {
      await Promise.allSettled([runCommand('docker', ['stop', '-t', '3', apiName], rootDir)]);
      if (apiProcess.process.exitCode === null) apiProcess.process.kill('SIGTERM');
    }
  });

  it('starts the real AdminJS image without Redis and performs zero startup DDL', async () => {
    const schemaBefore = await pool.query<{ identity: string }>(`
      SELECT n.nspname || ':' || c.relkind::text || ':' || c.relname AS identity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY identity
    `);
    const adminPort = await freePort();
    const adminProcess = startImage(rootDir, adminImage, adminName, adminPort, 4000, {
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: containerDatabaseUrl,
      ADMIN_COOKIE_PASSWORD: 'test-smoke-cookie-password-must-be-32-characters-minimum!',
      ADMIN_SESSION_SECRET: 'test-smoke-session-secret-must-be-32-characters-minimum!',
    });

    try {
      await expect(pollHealthCheck(adminPort, adminProcess)).resolves.toEqual({ ok: true });
      const schemaAfter = await pool.query<{ identity: string }>(`
        SELECT n.nspname || ':' || c.relkind::text || ':' || c.relname AS identity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY identity
      `);
      expect(schemaAfter.rows).toEqual(schemaBefore.rows);
    } finally {
      await Promise.allSettled([runCommand('docker', ['stop', '-t', '3', adminName], rootDir)]);
      if (adminProcess.process.exitCode === null) adminProcess.process.kill('SIGTERM');
    }
  });
});
