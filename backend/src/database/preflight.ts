import 'dotenv/config';
import { Pool } from 'pg';

export interface PreflightOptions {
  databaseUrl?: string;
  pool?: Pool;
  allowProduction?: boolean;
  allowRemote?: boolean;
  allowSystemDatabase?: boolean;
  expectedDatabaseName?: string;
  expectedDatabaseNames?: string[];
  confirmDatabaseName?: string;
  checkOnly?: boolean;
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
  isLoopback: boolean;
  isProduction: boolean;
}

const PROTECTED_SYSTEM_DATABASES = new Set([
  'postgres',
  'template0',
  'template1',
  'rdsadmin',
  'azure_sys',
  'azure_maintenance',
  'defaultdb',
]);

/**
 * Checks whether a host string represents an unambiguous local loopback or local socket.
 * Only loopback addresses (localhost, 127.0.0.0/8, ::1) or unix domain socket paths are trusted.
 * Private network IPs (10.x, 172.x, 192.168.x), Docker aliases, and remote hosts return false.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return true; // Socket / local default
  let trimmed = host.trim().toLowerCase();
  if (trimmed === '') return true;

  // Strip CIDR suffix (e.g. 127.0.0.1/32 -> 127.0.0.1, but keep /var/run/...)
  if (trimmed.includes('/') && !trimmed.startsWith('/') && !trimmed.startsWith('.')) {
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex > 0) {
      trimmed = trimmed.substring(0, slashIndex);
    }
  }

  // Unix domain socket directory / path
  if (trimmed.startsWith('/') || trimmed.startsWith('.')) {
    return true;
  }

  // Named localhost
  if (trimmed === 'localhost') {
    return true;
  }

  // IPv6 loopback variants (strip brackets if present)
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (
    unbracketed === '::1' ||
    unbracketed === '0:0:0:0:0:0:0:1' ||
    unbracketed === '::ffff:127.0.0.1' ||
    /^::ffff:127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(unbracketed)
  ) {
    return true;
  }

  // IPv4 loopback 127.0.0.0/8 (127.0.0.0 - 127.255.255.255)
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(unbracketed);
  if (ipv4Match) {
    const octets = [
      parseInt(ipv4Match[1], 10),
      parseInt(ipv4Match[2], 10),
      parseInt(ipv4Match[3], 10),
      parseInt(ipv4Match[4], 10),
    ];
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return octets[0] === 127;
    }
  }

  return false;
}

export const isLocalHost = isLoopbackHost;

export function extractDatabaseFromUrl(urlStr?: string): string | undefined {
  if (!urlStr) return undefined;
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim();
    return pathname || undefined;
  } catch {
    return undefined;
  }
}

export async function runDatabasePreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
  const logger = options.logger ?? console;
  const databaseUrl = options.databaseUrl ?? (options.pool ? undefined : process.env.DATABASE_URL);

  if (!databaseUrl && !options.pool) {
    throw new Error('[Preflight] DATABASE_URL is not set and no pg Pool was provided.');
  }

  // 1. Independent production environment verification
  const isProdEnv =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

  const allowProduction =
    options.allowProduction ??
    (process.env.ALLOW_PRODUCTION_DB_RESET === 'true' ||
      process.env.ALLOW_PRODUCTION_DATABASE_RESET === 'true' ||
      process.env.FORCE_DB_RESET === 'true');

  if (isProdEnv && !allowProduction) {
    throw new Error(
      `[Preflight] Destructive operation refused: environment indicates production (NODE_ENV=${process.env.NODE_ENV ?? ''}, APP_ENV=${process.env.APP_ENV ?? ''}, RAILWAY_ENVIRONMENT_NAME=${process.env.RAILWAY_ENVIRONMENT_NAME ?? ''}). Pass allowProduction or set ALLOW_PRODUCTION_DB_RESET=true to override.`,
    );
  }

  // 2. Early host verification from database URL or pool options
  const allowRemote =
    options.allowRemote ??
    (process.env.ALLOW_REMOTE_DB_RESET === 'true' || process.env.ALLOW_REMOTE_DATABASE_RESET === 'true');

  let hostFromUrl: string | undefined;
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      hostFromUrl = parsed.hostname;
    } catch {
      // invalid URL format, ignore
    }
  }

  const poolHost =
    (options.pool as { options?: { host?: string }; host?: string })?.options?.host ??
    (options.pool as { options?: { host?: string }; host?: string })?.host;

  const targetHost = hostFromUrl ?? poolHost;

  if (targetHost && !isLoopbackHost(targetHost) && !allowRemote) {
    throw new Error(
      `[Preflight] Destructive operation refused: target host "${targetHost}" is not an automatically trusted local loopback target. Pass allowRemote or set ALLOW_REMOTE_DB_RESET=true to override.`,
    );
  }

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl });

  try {
    // 3. Connect and query PostgreSQL server identity
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

    const connectedDbName = row.db_name;
    const serverIp = row.server_ip;

    // 4. Server IP verification if target host was not explicitly specified on client side
    if (!targetHost && serverIp && !isLoopbackHost(serverIp) && !allowRemote) {
      throw new Error(
        `[Preflight] Destructive operation refused: connected server IP "${serverIp}" is not an automatically trusted local loopback target. Pass allowRemote or set ALLOW_REMOTE_DB_RESET=true to override.`,
      );
    }

    // 5. Expected Database Name Verification
    const confirmName =
      options.confirmDatabaseName?.trim() ||
      process.env.CONFIRM_DB_RESET_NAME?.trim() ||
      process.env.CONFIRM_DATABASE_NAME?.trim();

    const expectedName = options.expectedDatabaseName?.trim() || process.env.EXPECTED_DATABASE_NAME?.trim();

    const poolDb =
      (options.pool as { options?: { database?: string }; database?: string })?.options?.database ??
      (options.pool as { options?: { database?: string }; database?: string })?.database;
    const configuredDbName =
      extractDatabaseFromUrl(databaseUrl) ?? (typeof poolDb === 'string' ? poolDb.trim() : undefined);

    if (confirmName) {
      if (connectedDbName !== confirmName) {
        throw new Error(
          `[Preflight] Destructive operation refused: target database name mismatch. Connected to "${connectedDbName}", but confirmed target is "${confirmName}".`,
        );
      }
    } else if (expectedName) {
      if (connectedDbName !== expectedName) {
        throw new Error(
          `[Preflight] Destructive operation refused: target database name mismatch. Connected to "${connectedDbName}", but expected "${expectedName}".`,
        );
      }
    } else if (options.expectedDatabaseNames && options.expectedDatabaseNames.length > 0) {
      const allowedNames = options.expectedDatabaseNames.map((n) => n.trim());
      if (!allowedNames.includes(connectedDbName)) {
        throw new Error(
          `[Preflight] Destructive operation refused: target database name mismatch. Connected to "${connectedDbName}", but expected one of: [${allowedNames.join(', ')}].`,
        );
      }
    } else if (configuredDbName) {
      if (connectedDbName !== configuredDbName) {
        throw new Error(
          `[Preflight] Destructive operation refused: target database name mismatch. Connected to "${connectedDbName}", but configured connection target is "${configuredDbName}".`,
        );
      }
    } else {
      throw new Error(
        '[Preflight] Destructive operation refused: an expected database name is required to verify the target PostgreSQL identity. Set CONFIRM_DB_RESET_NAME, expectedDatabaseName, or configure the database name in DATABASE_URL.',
      );
    }

    // 6. System Database Protection
    const allowSystemDatabase =
      options.allowSystemDatabase ??
      (process.env.ALLOW_SYSTEM_DB_RESET === 'true' || process.env.ALLOW_SYSTEM_DATABASE_RESET === 'true');

    if (PROTECTED_SYSTEM_DATABASES.has(connectedDbName.toLowerCase()) && !allowSystemDatabase) {
      throw new Error(
        `[Preflight] Destructive operation refused: target database "${connectedDbName}" is a PostgreSQL system database. Pass allowSystemDatabase or set ALLOW_SYSTEM_DB_RESET=true to override.`,
      );
    }

    // 7. Read-only schema & table inspection
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

    const hostLabel = hostFromUrl ?? serverIp ?? 'local socket';
    const isLoopback = isLoopbackHost(hostFromUrl ?? serverIp);
    const summary = `Target database "${connectedDbName}" on ${hostLabel}:${row.server_port ?? 'socket'} (user: ${row.db_user}, tables: ${publicTableCount}, drizzle: ${hasDrizzleSchema ? 'yes' : 'no'})`;
    logger.log(`[Preflight] ✓ Preflight check passed: ${summary}`);

    return {
      databaseName: connectedDbName,
      currentUser: row.db_user,
      serverAddress: row.server_ip,
      serverPort: row.server_port,
      version: row.db_version,
      publicTableCount,
      hasDrizzleSchema,
      isSafe: true,
      summary,
      isLoopback,
      isProduction: isProdEnv,
    };
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const allowProduction = args.includes('--force') || args.includes('--allow-production');
  const allowRemote = args.includes('--allow-remote');
  const allowSystemDatabase = args.includes('--allow-system-db');

  let confirmDatabaseName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--confirm-db' || args[i] === '--expected-db' || args[i] === '--db') {
      confirmDatabaseName = args[i + 1];
    } else if (args[i].startsWith('--confirm-db=')) {
      confirmDatabaseName = args[i].split('=')[1];
    } else if (args[i].startsWith('--expected-db=')) {
      confirmDatabaseName = args[i].split('=')[1];
    } else if (args[i].startsWith('--db=')) {
      confirmDatabaseName = args[i].split('=')[1];
    }
  }

  runDatabasePreflight({ allowProduction, allowRemote, allowSystemDatabase, confirmDatabaseName })
    .then((report) => {
      console.log('Preflight succeeded:', report.summary);
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error('Preflight check failed:', err.message);
      process.exit(1);
    });
}
