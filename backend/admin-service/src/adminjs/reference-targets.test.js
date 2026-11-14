import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPolymorphicReferenceHook, loadPolymorphicTargets, polymorphicResourceId } from './reference-targets.js';

function fakePool(tables) {
  const calls = [];
  return {
    calls,
    query: async (sql, [ids]) => {
      calls.push(sql);
      const table = /FROM (\w+)/.exec(sql)[1];
      return { rows: ids.filter((id) => tables[table]?.[id]).map((id) => ({ id, ...tables[table][id] })) };
    },
  };
}

describe('polymorphic reference targets', () => {
  it('maps a target type to its admin resource', () => {
    assert.equal(polymorphicResourceId('POST'), 'posts');
    assert.equal(polymorphicResourceId('COMMENT'), 'comments');
    assert.equal(polymorphicResourceId('USER'), 'users');
    assert.equal(polymorphicResourceId('CONTACT_REQUEST'), 'contact_requests');
    assert.equal(polymorphicResourceId('NOPE'), null);
  });

  it('runs one query per distinct type, however many rows share it', async () => {
    const pool = fakePool({ posts: { p1: { title: 'One' }, p2: { title: 'Two' } }, users: { u1: { full_name: 'U' } } });
    const found = await loadPolymorphicTargets(pool, [
      { type: 'POST', id: 'p1' },
      { type: 'POST', id: 'p2' },
      { type: 'POST', id: 'p1' },
      { type: 'USER', id: 'u1' },
      { type: 'POST', id: 'gone' },
      { type: 'UNKNOWN', id: 'x' },
      { type: 'POST', id: null },
    ]);
    assert.equal(pool.calls.length, 2);
    assert.equal(found.get('POST:p1').title, 'One');
    assert.equal(found.get('USER:u1').full_name, 'U');
    assert.equal(found.get('POST:gone'), null, 'a missing row is reported as missing');
    assert.equal(found.has('UNKNOWN:x'), false);
  });

  it('adds the resolved target to each record like a populated reference', async () => {
    const pool = fakePool({ posts: { p1: { title: 'One' } }, comments: {} });
    const hook = buildPolymorphicReferenceHook(pool, { typeField: 'target_type', idField: 'target_id' });
    const response = await hook({
      records: [
        { params: { target_type: 'POST', target_id: 'p1' } },
        { params: { target_type: 'COMMENT', target_id: 'c-gone' } },
        { params: { target_type: 'POST', target_id: null } },
      ],
    });
    const [post, comment, none] = response.records;
    assert.deepEqual(post.populated.target_id, {
      id: 'p1',
      resourceId: 'posts',
      missing: false,
      params: { id: 'p1', title: 'One' },
    });
    assert.equal(comment.populated.target_id.missing, true);
    assert.equal(comment.populated.target_id.resourceId, 'comments');
    assert.equal(none.populated, undefined);
    assert.equal(pool.calls.length, 2);
  });

  it('works for a single show record and without a pool', async () => {
    const pool = fakePool({ users: { u1: { email: 'a@x.test' } } });
    const hook = buildPolymorphicReferenceHook(pool, { typeField: 'source_type', idField: 'source_id' });
    const shown = await hook({ record: { params: { source_type: 'USER', source_id: 'u1' } } });
    assert.equal(shown.record.populated.source_id.params.email, 'a@x.test');
    const noPool = await buildPolymorphicReferenceHook(undefined, { typeField: 'a', idField: 'b' })({ records: [] });
    assert.deepEqual(noPool, { records: [] });
  });
});
