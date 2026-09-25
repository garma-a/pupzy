import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOST_SUBTYPE_VALUES,
  REPORT_REVIEW_STATE_VALUES,
  applyVirtualFilter,
  virtualFilterNames,
  virtualFilterOptions,
  virtualFilterProperties,
} from './queue-filters.js';
import { createAdminSqlClient } from './sql-adapter.js';

describe('Admin work-queue virtual filters', () => {
  it('exposes the lost/found subtype and completed-history selectors for posts', () => {
    assert.deepEqual(virtualFilterNames('posts').sort(), ['queue', 'report_type']);
    const options = virtualFilterOptions('posts');
    assert.deepEqual(
      options.report_type.availableValues.map(({ value }) => value),
      [...LOST_SUBTYPE_VALUES],
    );
    assert.deepEqual(
      options.queue.availableValues.map(({ value }) => value),
      ['completed'],
    );
    assert.deepEqual(options.report_type.isVisible, { list: false, show: false, edit: false, filter: true });
    assert.deepEqual(options.queue.isVisible, { list: false, show: false, edit: false, filter: true });
  });

  it('exposes an open/reviewed selector for every Report resource', () => {
    for (const table of ['post_reports', 'comment_reports', 'account_reports']) {
      assert.deepEqual(virtualFilterNames(table), ['review_state']);
      assert.deepEqual(
        virtualFilterOptions(table).review_state.availableValues.map(({ value }) => value),
        [...REPORT_REVIEW_STATE_VALUES],
      );
    }
  });

  it('creates non-editable virtual properties with the allowed values', () => {
    const properties = virtualFilterProperties('post_reports');
    assert.equal(properties.length, 1);
    assert.equal(properties[0].name(), 'review_state');
    assert.equal(properties[0].isEditable(), false);
    assert.deepEqual(properties[0].availableValues(), [...REPORT_REVIEW_STATE_VALUES]);
  });

  it('returns no virtual filters for unrelated tables', () => {
    assert.deepEqual(virtualFilterNames('users'), []);
    assert.deepEqual(virtualFilterProperties('users'), []);
  });

  it('translates the lost/found subtype into a lost_posts predicate', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const query = sql('posts');
      const applied = applyVirtualFilter(query, {
        tableName: 'posts',
        key: 'report_type',
        value: 'FOUND_STRAY',
        knex: sql,
        schemaName: 'public',
      });
      assert.equal(applied, true);
      const compiled = query.toSQL();
      assert.match(compiled.sql, /where "id" in \(select "post_id" from "public"\."lost_posts"/);
      assert.match(compiled.sql, /"report_type" = \?/);
      assert.deepEqual(compiled.bindings, ['FOUND_STRAY']);
    } finally {
      await sql.destroy();
    }
  });

  it('translates the completed history queue into the outcome statuses', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const query = sql('posts');
      const applied = applyVirtualFilter(query, {
        tableName: 'posts',
        key: 'queue',
        value: 'completed',
        knex: sql,
        schemaName: 'public',
      });
      assert.equal(applied, true);
      const compiled = query.toSQL();
      assert.match(compiled.sql, /where "status" in \(\?, \?, \?, \?, \?\)/);
      assert.deepEqual(compiled.bindings, ['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'ANIMAL_DECEASED']);
    } finally {
      await sql.destroy();
    }
  });

  it('translates report review state into the reviewed_at predicate', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const openQuery = sql('post_reports');
      applyVirtualFilter(openQuery, {
        tableName: 'post_reports',
        key: 'review_state',
        value: 'OPEN',
        knex: sql,
        schemaName: 'public',
      });
      assert.match(openQuery.toSQL().sql, /where "reviewed_at" is null/);

      const reviewedQuery = sql('account_reports');
      applyVirtualFilter(reviewedQuery, {
        tableName: 'account_reports',
        key: 'review_state',
        value: 'REVIEWED',
        knex: sql,
        schemaName: 'public',
      });
      assert.match(reviewedQuery.toSQL().sql, /where "reviewed_at" is not null/);
    } finally {
      await sql.destroy();
    }
  });

  it('ignores unknown values, keys and tables instead of emitting column predicates', async () => {
    const sql = createAdminSqlClient({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' });
    try {
      const cases = [
        { tableName: 'posts', key: 'report_type', value: 'SOMETHING_ELSE' },
        { tableName: 'posts', key: 'queue', value: 'anything' },
        { tableName: 'post_reports', key: 'review_state', value: 'MAYBE' },
        { tableName: 'posts', key: 'unknown_key', value: 'FLAGGED' },
        { tableName: 'users', key: 'review_state', value: 'OPEN' },
      ];
      for (const options of cases) {
        const query = sql(options.tableName);
        const applied = applyVirtualFilter(query, { ...options, knex: sql, schemaName: 'public' });
        assert.equal(applied, false, `${options.tableName}.${options.key}=${options.value} must be ignored`);
        assert.equal(query.toSQL().sql, `select * from "${options.tableName}"`);
      }
    } finally {
      await sql.destroy();
    }
  });
});
