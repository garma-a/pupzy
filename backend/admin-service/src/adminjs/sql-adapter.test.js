import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_RESOURCE_TABLES } from './index.js';
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

  it('exports ADMIN_RESOURCE_TABLES with exactly the 20 domain tables', () => {
    const expectedTables = [
      'users',
      'posts',
      'rescue_posts',
      'lost_posts',
      'adoption_posts',
      'product_posts',
      'mating_posts',
      'post_media',
      'post_upvotes',
      'post_saves',
      'post_reports',
      'contact_requests',
      'adoption_applications',
      'saved_searches',
      'notifications',
      'cities',
      'vet_clinics',
      'admin_users',
      'moderation_actions',
      'vet_clinic_location_audits',
    ];
    assert.deepEqual([...ADMIN_RESOURCE_TABLES], expectedTables);
    assert.equal(ADMIN_RESOURCE_TABLES.includes('spatial_ref_sys'), false);
    assert.equal(ADMIN_RESOURCE_TABLES.includes('admin_sessions'), false);
  });
});

