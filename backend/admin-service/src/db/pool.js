import pg from "pg";

const { Pool } = pg;

/** Create the small, isolated database pool used only by admin traffic. */
export function createPool(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 8_000,
  });

  pool.on("error", (error) => {
    console.error("[admin-service] Unexpected pool error:", error);
  });

  return pool;
}
