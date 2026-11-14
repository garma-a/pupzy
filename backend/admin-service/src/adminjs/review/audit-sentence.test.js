import assert from 'node:assert/strict';
import { it } from 'node:test';
import { auditSentence } from './audit-sentence.js';
it('reads an audit action as an actor, verb, target and reason', () => {
  assert.equal(
    auditSentence({ actor: 'Mona Moderator', action: 'POST_REMOVED', target: 'Kitten under car', reason: 'spam' }),
    'Mona Moderator removed post “Kitten under car” — “spam”',
  );
});
it('keeps a recorded completion outcome and an absent administrator readable', () => {
  assert.equal(
    auditSentence({ action: 'POST_RESOLVED', target: 'Bella', metadata: { outcome: 'REUNITED' } }),
    'Removed administrator completed post “Bella” as reunited',
  );
});

it('populates actors for a whole audit page in one query without private fields', async () => {
  const { attachAuditActors } = await import('./audit-sentence.js');
  const calls = [];
  const records = Array.from({ length: 25 }, (_, i) => ({
    params: { admin_user_id: i % 2 ? 'a' : 'b' },
    populated: { target_id: { id: 'target' } },
  }));
  await attachAuditActors(
    {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ id: 'a', full_name: 'Mona' }] };
      },
    },
    { records },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[0].length, 2);
  assert.equal(records[1].populated.admin_user_id.params.full_name, 'Mona');
  assert.equal(records[0].populated.admin_user_id.missing, true);
  assert.equal(records[1].populated.target_id.id, 'target');
  assert.doesNotMatch(calls[0].sql, /password/);
});
