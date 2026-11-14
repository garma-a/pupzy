import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loadReportCase, attachReportCase } from './case-view.js';
it('rejects unknown case kinds before interpolating an identifier', async () => {
  const pool = { query: () => assert.fail('query called') };
  for (const kind of ['not_a_resource', '__proto__', 'posts; DROP TABLE users'])
    await assert.rejects(loadReportCase(pool, kind, {}));
});
it('loads a Post case with fixed batched queries, readable closure and media', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM post_reports'))
        return {
          rows: [
            {
              id: 'other',
              reason: 'SPAM',
              reviewed_at: '2026-01-01',
              review_outcome: 'ACTION_TAKEN',
              reporter_name: 'Mona',
              total: 30,
            },
          ],
        };
      if (sql.includes('FROM moderation_actions')) return { rows: [] };
      if (sql.includes('FROM posts p'))
        return {
          rows: [
            {
              id: 'post',
              title: 'قط',
              description: 'Evidence',
              post_type: 'RESCUE',
              status: 'ACTIVE',
              moderation_status: 'FLAGGED',
              creator_id: 'owner',
              owner_name: 'Omar',
            },
          ],
        };
      if (sql.includes('FROM post_media'))
        return { rows: [{ id: 'photo', public_url: 'https://example.test/photo.jpg' }] };
      throw new Error(sql);
    },
  };
  const result = await loadReportCase(pool, 'post_reports', { id: 'report', post_id: 'post' });
  assert.equal(calls.length, 4);
  assert.equal(result.otherReportsTotal, 30);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].statusState, 'ACTION_TAKEN');
  assert.equal(result.post.moderationLabel, 'Flagged');
  assert.equal(result.photos[0].available, true);
  assert.ok(calls.every((c) => c.params.includes('post')));
  assert.ok(calls.every((c) => !c.sql.includes("='post'")));
});
it('preserves existing show authorization and hooks when attaching the case view', () => {
  const before = () => {};
  const accessible = () => false;
  const after = () => {};
  const input = {
    resource: { tableName: 'post_reports' },
    options: { actions: { show: { before, isAccessible: accessible, after } } },
  };
  const result = attachReportCase(input, {}, { ReportCase: 'Case' });
  assert.equal(result.options.actions.show.before, before);
  assert.equal(result.options.actions.show.isAccessible, accessible);
  assert.equal(result.options.actions.show.after[0], after);
  assert.equal(result.options.actions.show.component, 'Case');
});
