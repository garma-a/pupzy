import 'dotenv/config';
import { Pool } from 'pg';

export interface PreflightOptions {
  databaseUrl?: string;
  pool?: Pool;
  allowProduction?: boolean;
  allowRemote?: boolean;
  expectedDatabaseNames?: string[];
  logger?: {
    log: (msg: string) => void;
    warn?: (msg: string) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface PreflightReport {
  databaseName: string;
  currentUser: string;
  serverAddress: string | null;
  serverPort: number | null;
  version: string;
  publicTableCount: number;
  hasDrizzleSchema: boolean;
  isSafe: boolean;
  summary: string;
}

const LOCAL_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', '172.', '10.', '192.168.'];

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return true; // Socket / local default
  const lower = host.toLowerCase().trim();
  return LOCAL_HOST_PATTERNS.some((pattern) => lower === pattern || lower.startsWith(pattern));
}

export async function runDatabasePreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
  const logger = options.logger ?? console;
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl && !options.pool) {
    throw new Error('[Preflight] DATABASE_URL is not set and no pg Pool was provided.');
  }

  // Early safety checks prior to establishing connection
  const isProdEnv =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

  if (isProdEnv && !options.allowProduction) {
    throw new Error(
      `[Preflight] Destructive operation refused: NODE_ENV or RAILWAY_ENVIRONMENT_NAME indicates production. Pass allowProduction to override.`,
    );
  }

  let hostFromUrl: string | undefined;
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      hostFromUrl = parsed.hostname;
    } catch {
      // invalid URL format, ignore
    }
  }

  if (hostFromUrl && !isLocalHost(hostFromUrl) && !options.allowRemote) {
    throw new Error(
      `[Preflight] Destructive operation refused: target host "${hostFromUrl}" appears to be a remote database. Pass allowRemote to override.`,
    );
  }

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl });

  try {
    const identRes = await pool.query<{
      db_name: string;
      db_user: string;
      server_ip: string | null;
      server_port: number | null;
      db_version: string;
    }>(`
      SELECT
        current_database() AS db_name,
        current_user AS db_user,
        inet_server_addr()::text AS server_ip,
        inet_server_port() AS server_port,
        version() AS db_version
    `);

    const row = identRes.rows[0];
    if (!row) {
      throw new Error('[Preflight] Unable to identify database connection properties.');
    }

    const tableRes = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const publicTableCount = parseInt(tableRes.rows[0]?.count ?? '0', 10);

    const schemaRes = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM information_schema.schemata
      WHERE schema_name = 'drizzle'
    `);
    const hasDrizzleSchema = parseInt(schemaRes.rows[0]?.count ?? '0', 10) > 0;

    const hostToCheck = hostFromUrl ?? row.server_ip;
    const isLocal = isLocalHost(hostToCheck);

    if (!isLocal && !options.allowRemote) {
      throw new Error(
        `[Preflight] Destructive operation refused: target host "${hostToCheck}" appears to be a remote database. Pass allowRemote to override.`,
      );
    }

    // System database protection
    const SYSTEM_DBS = new Set(['postgres', 'template0', 'template1']);
    if (SYSTEM_DBS.has(row.db_name) && !options.expectedDatabaseNames?.includes(row.db_name)) {
      throw new Error(
        `[Preflight] Destructive operation refused: target database "${row.db_name}" is a PostgreSQL system database.`,
      );
    }

    const summary = `Target database "${row.db_name}" on ${hostToCheck || 'localhost'}:${row.server_port || 5432} (user: ${row.db_user}, tables: ${publicTableCount}, drizzle: ${hasDrizzleSchema ? 'yes' : 'no'})`;
    logger.log(`[Preflight] ✓ Preflight check passed: ${summary}`);

    return {
      databaseName: row.db_name,
      currentUser: row.db_user,
      serverAddress: row.server_ip,
      serverPort: row.server_port,
      version: row.db_version,
      publicTableCount,
      hasDrizzleSchema,
      isSafe: true,
      summary,
    };
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runDatabasePreflight()
    .then((report) => {
      console.log('Preflight succeeded:', report.summary);
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error('Preflight check failed:', err.message);
      process.exit(1);
    });
}
