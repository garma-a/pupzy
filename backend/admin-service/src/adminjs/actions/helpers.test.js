import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readModerationReason, runModerationAction } from './helpers.js';

function mockPool({ row = { id: 'target-id' } } = {}) {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT *')) return { rows: row ? [row] : [] };
      return { rows: [], rowCount: 1 };
    },
    release() {
      queries.push({ sql: 'RELEASE' });
    },
  };
  return { pool: { connect: async () => client }, queries };
}

describe('runModerationAction', () => {
  it('bounds moderation reasons to 500 characters', () => {
    assert.deepEqual(readModerationReason('  spam  '), { reason: 'spam' });
    assert.deepEqual(readModerationReason('x'.repeat(501)), {
      error: 'A reason must be at most 500 characters.',
    });
  });

  it('commits the mutation and audit row together', async () => {
    const { pool, queries } = mockPool();
    let onSuccessCalled = false;
    const result = await runModerationAction(pool, {
      table: 'users',
      id: 'target-id',
      adminUserId: 'admin-id',
      actionType: 'USER_BANNED',
      targetType: 'USER',
      reason: 'spam',
      onSuccess: () => {
        onSuccessCalled = true;
      },
      mutate: (client) => client.query('UPDATE users SET is_banned = true WHERE id = $1', ['target-id']),
    });

    assert.equal(result.ok, true);
    assert.equal(onSuccessCalled, true);
    assert.deepEqual(
      queries.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 2).join(' ')),
      ['BEGIN', 'SELECT *', 'UPDATE users', 'INSERT INTO', 'COMMIT', 'RELEASE'],
    );
  });

  it('rolls back without an audit row when mutation fails', async () => {
    const { pool, queries } = mockPool();
    await assert.rejects(
      runModerationAction(pool, {
        table: 'posts',
        id: 'target-id',
        adminUserId: 'admin-id',
        actionType: 'POST_REMOVED',
        targetType: 'POST',
        mutate: async () => {
          throw new Error('mutation failed');
        },
      }),
      /mutation failed/,
    );
    assert.equal(
      queries.some(({ sql }) => sql.includes('INSERT INTO moderation_actions')),
      false,
    );
    assert.equal(
      queries.some(({ sql }) => sql === 'ROLLBACK'),
      true,
    );
  });

  it('returns not found and performs zero writes', async () => {
    const { pool, queries } = mockPool({ row: null });
    const result = await runModerationAction(pool, {
      table: 'users',
      id: 'missing',
      adminUserId: 'admin-id',
      actionType: 'USER_BANNED',
      targetType: 'USER',
      mutate: async () => assert.fail('must not mutate'),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/);
    assert.deepEqual(
      queries.map(({ sql }) => sql),
      ['BEGIN', 'SELECT * FROM users WHERE id = $1 FOR UPDATE', 'ROLLBACK', 'RELEASE'],
    );
  });
});
