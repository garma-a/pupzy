import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

import { buildAdminUsersResource, prepareAdminCredentials } from './admin-users.resource.js';

describe('admin password hook', () => {
  it('hashes a plaintext password before create or edit', async () => {
    const request = {
      method: 'post',
      payload: { password_hash: 'correct horse battery staple' },
    };
    await prepareAdminCredentials(request, { action: { name: 'new' } });
    assert.notEqual(request.payload.password_hash, 'correct horse battery staple');
    assert.match(request.payload.password_hash, /^\$2/);
    assert.equal(await bcrypt.compare('correct horse battery staple', request.payload.password_hash), true);
  });

  it('strips an empty password so edit preserves the stored hash', async () => {
    const request = {
      method: 'post',
      payload: { full_name: 'Changed', password_hash: '' },
    };
    await prepareAdminCredentials(request, { action: { name: 'edit' } });
    assert.equal('password_hash' in request.payload, false);
    assert.equal(request.payload.full_name, 'Changed');
  });

  it('normalizes valid emails and rejects weak or oversized passwords', async () => {
    const valid = {
      method: 'post',
      payload: {
        email: '  Staff@Example.COM ',
        password_hash: 'a sufficiently long password',
      },
    };
    await prepareAdminCredentials(valid, { action: { name: 'new' } });
    assert.equal(valid.payload.email, 'staff@example.com');

    for (const password of ['too short', 'x'.repeat(73)]) {
      await assert.rejects(
        prepareAdminCredentials(
          { method: 'post', payload: { email: 'staff@example.com', password_hash: password } },
          { action: { name: 'new' } },
        ),
        (error) => Boolean(error.statusCode === 400 && error.propertyErrors.password_hash),
      );
    }
  });

  it('requires a password when creating an admin and validates email', async () => {
    await assert.rejects(
      prepareAdminCredentials(
        { method: 'post', payload: { email: 'not-an-email', password_hash: '' } },
        { action: { name: 'new' } },
      ),
      (error) => Boolean(error.statusCode === 400 && error.propertyErrors.email && error.propertyErrors.password_hash),
    );
  });
  it('removes password hashes from AdminJS action responses', async () => {
    const db = { table: (name) => ({ name }) };
    const resource = buildAdminUsersResource(db);
    const response = {
      record: { params: { email: 'admin.com', password_hash: 'secret hash' } },
      records: [{ params: { password_hash: 'another hash' } }],
    };
    const sanitized = await resource.options.actions.list.after(response);
    assert.equal('password_hash' in sanitized.record.params, false);
    assert.equal('password_hash' in sanitized.records[0].params, false);
  });
});
