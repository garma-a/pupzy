import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAdminSqlClient } from './sql-adapter.js';

describe('AdminJS SQL adapter compatibility', () => {
  it('caps the Knex pool before any database introspection can run', async () => {
    const sql = createAdminSqlClient({
      connectionString: 'postgresql://test:test@127.0.0.1:5432/test',
      database: 'test',
    });

    try {
      assert.equal(sql.client.pool.min, 0);
      assert.equal(sql.client.pool.max, 3);
      assert.equal(sql.client.pool.idleTimeoutMillis, 10_000);
    } finally {
      await sql.destroy();
    }
  });
});
