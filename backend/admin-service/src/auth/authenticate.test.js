import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

import { buildAuthenticate } from './authenticate.js';

async function authenticateWith(overrides = {}, authOptions = {}) {
  const row = {
    id: 'admin-id',
    email: 'admin@example.com',
    password_hash: await bcrypt.hash('correct password', 4),
    role: 'SUPER_ADMIN',
    full_name: 'Admin',
    is_active: true,
    ...overrides,
  };
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id')) return { rows: overrides.missing ? [] : [row] };
      return { rows: [] };
    },
  };
  let regenerationCount = 0;
  const context = {
    req: {
      ip: '127.0.0.1',
      session: {
        regenerate(callback) {
          regenerationCount += 1;
          callback();
        },
      },
    },
  };
  return {
    authenticate: buildAuthenticate(pool, authOptions),
    calls,
    context,
    get regenerationCount() {
      return regenerationCount;
    },
  };
}

describe('admin authentication', () => {
  it('returns an admin and updates last_login_at on valid credentials', async () => {
    const fixture = await authenticateWith();
    const { authenticate, calls, context } = fixture;
    const result = await authenticate(' ADMIN@example.com ', 'correct password', context);
    assert.deepEqual(result, {
      id: 'admin-id',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
      fullName: 'Admin',
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].values, ['admin@example.com']);
    assert.equal(fixture.regenerationCount, 1);
  });

  for (const [name, overrides, password] of [
    ['wrong password', {}, 'wrong'],
    ['missing user', { missing: true }, 'correct password'],
    ['inactive user', { is_active: false }, 'correct password'],
  ]) {
    it(`returns null and does not update login time for ${name}`, async () => {
      const fixture = await authenticateWith(overrides);
      const { authenticate, calls, context } = fixture;
      assert.equal(await authenticate('admin@example.com', password, context), null);
      assert.equal(calls.length, 1);
      assert.equal(fixture.regenerationCount, 0);
    });
  }

  it('fails closed when the session identifier cannot be rotated', async () => {
    const { authenticate } = await authenticateWith();

    await assert.rejects(
      authenticate('admin@example.com', 'correct password', { req: {} }),
      /session regeneration is unavailable/i,
    );
  });

  it('bounds and records failures per normalized account plus IP', async () => {
    const failures = [];
    const fixture = await authenticateWith(
      {},
      {
        maxFailedAttempts: 1,
        onFailure: (failure) => failures.push(failure),
      },
    );

    assert.equal(await fixture.authenticate('ADMIN@example.com', 'wrong', fixture.context), null);
    assert.equal(await fixture.authenticate(' admin@example.com ', 'wrong', fixture.context), null);
    assert.equal(fixture.calls.length, 1, 'blocked attempts must not query PostgreSQL');
    assert.deepEqual(failures, [
      {
        ip: '127.0.0.1',
        email: 'admin@example.com',
        blocked: false,
        trackedFailures: 1,
      },
      {
        ip: '127.0.0.1',
        email: 'admin@example.com',
        blocked: true,
        trackedFailures: 1,
      },
    ]);
  });

  it('caps tracked failure keys under rotating-account abuse', async () => {
    const fixture = await authenticateWith({}, { maxFailedAttempts: 1, maxTrackedFailures: 1 });

    assert.equal(await fixture.authenticate('one@example.com', 'wrong', fixture.context), null);
    assert.equal(await fixture.authenticate('two@example.com', 'wrong', fixture.context), null);
    assert.equal(await fixture.authenticate('one@example.com', 'wrong', fixture.context), null);
    assert.equal(fixture.calls.length, 3, 'the oldest bounded key should be evicted');
  });

  it('keeps the failure-key cap under concurrent rotating-account attempts', async () => {
    const trackedSizes = [];
    const fixture = await authenticateWith(
      {},
      {
        maxFailedAttempts: 1,
        maxTrackedFailures: 1,
        onFailure: ({ trackedFailures }) => trackedSizes.push(trackedFailures),
      },
    );

    await Promise.all(
      ['one', 'two', 'three', 'four'].map((name) =>
        fixture.authenticate(`${name}@example.com`, 'wrong', fixture.context),
      ),
    );
    assert.equal(Math.max(...trackedSizes), 1);
  });

  it('counts concurrent failures for the same account without lost increments', async () => {
    const fixture = await authenticateWith({}, { maxFailedAttempts: 2 });

    await Promise.all([
      fixture.authenticate('admin@example.com', 'wrong', fixture.context),
      fixture.authenticate('admin@example.com', 'wrong', fixture.context),
    ]);
    assert.equal(await fixture.authenticate('admin@example.com', 'wrong', fixture.context), null);
    assert.equal(fixture.calls.length, 2, 'the third attempt must be blocked before PostgreSQL');
  });

  it('rejects oversized login identifiers before keying, logging, or querying them', async () => {
    const failures = [];
    const fixture = await authenticateWith({}, { onFailure: (failure) => failures.push(failure) });
    const oversizedEmail = `${'x'.repeat(256)}@example.com`;

    assert.equal(await fixture.authenticate(oversizedEmail, 'wrong', fixture.context), null);
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(failures, [{ ip: '127.0.0.1', invalidIdentifier: true, blocked: false }]);
  });
});
