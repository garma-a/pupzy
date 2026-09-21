import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Property, ResourceMetadata } from '@adminjs/sql';

import { ADMIN_RESOURCE_TABLES } from './index.js';
import { QueueAwareSqlResource, createAdminSqlClient } from './sql-adapter.js';

function column(name, extra = {}) {
  return new Property({
    name,
    isId: false,
    position: 1,
    isNullable: true,
    isEditable: true,
    type: 'string',
    ...extra,
  });
}

function buildResource(sql, tableName, columns) {
  const properties = [
    new Property({
      name: 'id',
      isId: true,
      position: 0,
      isNullable: false,
      isEditable: false,
      type: 'uuid',
    }),
    ...columns,
  ];
  return new QueueAwareSqlResource(new ResourceMetadata('postgresql', sql, 'test', 'public', tableName, properties));
}

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

  it('keeps real column filters intact while translating work-queue filters', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const resource = buildResource(sql, 'posts', [
        column('moderation_status', { availableValues: ['CLEAN', 'FLAGGED', 'PENDING_AUTO_REVIEW'] }),
        column('status', { availableValues: ['ACTIVE', 'EXPIRED'] }),
      ]);
      assert.deepEqual(resource.virtualFilterNames, new Set(['report_type', 'queue']));

      const query = resource.filterQuery({
        filters: {
          moderation_status: { property: resource.property('moderation_status'), value: 'FLAGGED' },
          status: { property: resource.property('status'), value: 'ACTIVE' },
          report_type: { property: resource.property('report_type'), value: 'LOST_PET' },
        },
      });
      const compiled = query.toSQL();
      assert.match(compiled.sql, /"moderation_status" = \?/);
      assert.match(compiled.sql, /"status" = \?/);
      assert.match(compiled.sql, /"id" in \(select "post_id" from "public"\."lost_posts"/);
      assert.deepEqual(compiled.bindings, ['FLAGGED', 'ACTIVE', 'LOST_PET']);
    } finally {
      await sql.destroy();
    }
  });

  it('translates report review-state filters and ignores unknown virtual values', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const resource = buildResource(sql, 'post_reports', [column('reviewed_at', { type: 'datetime' })]);
      assert.deepEqual(resource.virtualFilterNames, new Set(['review_state']));

      const openQuery = resource.filterQuery({
        filters: { review_state: { property: resource.property('review_state'), value: 'OPEN' } },
      });
      assert.match(openQuery.toSQL().sql, /where "reviewed_at" is null/);

      const unknownQuery = resource.filterQuery({
        filters: { review_state: { property: resource.property('review_state'), value: 'NOT_A_STATE' } },
      });
      assert.equal(unknownQuery.toSQL().sql, 'select * from "public"."post_reports"');
    } finally {
      await sql.destroy();
    }
  });

  it('exports ADMIN_RESOURCE_TABLES with exactly the 23 domain tables', () => {
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
      'comment_reports',
      'account_reports',
      'comments',
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
