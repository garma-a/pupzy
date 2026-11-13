import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INBOX_PAGE_SIZE, buildInboxPageSql, loadInbox, parseInboxQuery } from './inbox.js';

describe('Inbox query', () => {
  it('falls back to the defaults for anything unknown', () => {
    assert.deepEqual(parseInboxQuery({}), { kind: 'all', order: 'oldest', page: 1 });
    assert.deepEqual(parseInboxQuery({ kind: 'drop table', order: 'sideways', page: '-3' }), {
      kind: 'all',
      order: 'oldest',
      page: 1,
    });
    assert.deepEqual(parseInboxQuery({ kind: 'flagged', order: 'newest', page: '4' }), {
      kind: 'flagged',
      order: 'newest',
      page: 4,
    });
  });

  it('groups open reports per target and queries only the kinds asked for', () => {
    const all = buildInboxPageSql({ kind: 'all', order: 'oldest' });
    assert.match(all, /GROUP BY post_id/);
    assert.match(all, /GROUP BY comment_id/);
    assert.match(all, /GROUP BY reported_user_id/);
    assert.match(all, /FULL JOIN/, 'a flagged Post and its reports are one row');
    assert.match(all, /ORDER BY since ASC/);
    assert.match(all, new RegExp(`LIMIT ${INBOX_PAGE_SIZE} OFFSET \\$1`));
    const flagged = buildInboxPageSql({ kind: 'flagged', order: 'newest' });
    assert.match(flagged, /moderation_status IN \('FLAGGED'\)/);
    assert.match(flagged, /COALESCE\(moderated_at, created_at\)/);
    assert.doesNotMatch(flagged, /comment_reports|account_reports/);
    assert.match(flagged, /ORDER BY latest DESC/);
    const reports = buildInboxPageSql({ kind: 'post_report', order: 'oldest' });
    assert.match(reports, /FROM \(\s*SELECT post_id, count/);
    assert.doesNotMatch(reports, /comment_reports/);
  });
});

function fakePool() {
  const calls = [];
  const pageRows = [
    {
      kind: 'post',
      target_id: 'p1',
      case_id: 'r1',
      report_count: 3,
      since: '2026-11-01T00:00:00Z',
      post_state: null,
      total: 27,
    },
    {
      kind: 'comment_report',
      target_id: 'c1',
      case_id: 'r2',
      report_count: 1,
      since: '2026-11-02T00:00:00Z',
      post_state: null,
      total: 27,
    },
    {
      kind: 'account_report',
      target_id: 'u1',
      case_id: 'r3',
      report_count: 2,
      since: '2026-11-03T00:00:00Z',
      post_state: null,
      total: 27,
    },
    {
      kind: 'post',
      target_id: 'p2',
      case_id: null,
      report_count: 0,
      since: '2026-11-04T00:00:00Z',
      post_state: 'flagged',
      total: 27,
    },
    {
      kind: 'post',
      target_id: 'p3',
      case_id: 'r4',
      report_count: 2,
      since: '2026-11-05T00:00:00Z',
      post_state: 'pending',
      total: 27,
    },
  ];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('WITH cases(')) return { rows: pageRows };
      if (sql.includes('FROM post_reports r')) {
        return {
          rows: [
            { case_id: 'r1', reason: 'SPAM', reporter_id: 'u9', reporter_name: 'Mona', reporter_picture: null },
            { case_id: 'r4', reason: 'SCAM', reporter_id: 'u6', reporter_name: 'Nour', reporter_picture: null },
          ],
        };
      }
      if (sql.includes('FROM comment_reports r')) {
        return {
          rows: [
            {
              case_id: 'r2',
              reason: 'HARASSMENT',
              reporter_id: 'u8',
              reporter_name: 'Sam',
              text: 'مرحبا '.repeat(40),
              photo_key: 'comments/a.jpg',
              author_name: 'Ann',
            },
          ],
        };
      }
      if (sql.includes('FROM account_reports r')) {
        return {
          rows: [
            {
              case_id: 'r3',
              reason: 'SCAM_OR_FRAUD',
              reporter_id: 'u7',
              reporter_name: 'Lee',
              target_name: 'Bad Actor',
              target_picture: null,
            },
          ],
        };
      }
      if (sql.includes('FROM posts p')) {
        return {
          rows: [
            { target_id: 'p1', title: 'Kitten', photo: 'https://x/1.jpg', moderation_reason: null },
            { target_id: 'p2', title: 'Odd post', photo: null, moderation_reason: 'Looks like spam' },
            { target_id: 'p3', title: 'Waiting post', photo: null, moderation_reason: null },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

describe('loadInbox', () => {
  it('shapes one row per target with a constant number of queries', async () => {
    const pool = fakePool();
    const inbox = await loadInbox(pool, { page: '2' }, { COMMENT_MEDIA_CDN_BASE: 'https://cdn.test' });

    assert.equal(pool.calls.length, 5, '1 page query + 4 batched detail queries');
    assert.deepEqual(pool.calls[0].params, [INBOX_PAGE_SIZE], 'page 2 skips one full page');
    assert.equal(inbox.total, 27);
    assert.equal(inbox.totalPages, 2);
    assert.equal(inbox.page, 2);

    const [post, comment, account, flagged, pendingWithReports] = inbox.items;
    assert.equal(post.kind, 'post_report');
    assert.equal(post.kindLabel, 'Post report');
    assert.equal(post.reportCount, 3);
    assert.equal(post.title, 'Kitten');
    assert.equal(post.thumbnailUrl, 'https://x/1.jpg');
    assert.equal(post.reasonLabel, 'Spam');
    assert.equal(post.reporter.name, 'Mona');
    assert.deepEqual(post.target, { resource: 'post_reports', id: 'r1' });

    assert.equal(comment.thumbnailUrl, 'https://cdn.test/comments/a.jpg');
    assert.ok(comment.title.length <= 120 && comment.title.endsWith('…'));
    assert.equal(comment.avatar, null);

    assert.equal(account.title, 'Bad Actor');
    assert.equal(account.avatar.name, 'Bad Actor');
    assert.equal(account.reasonLabel, 'Scam or fraud');

    assert.equal(flagged.kindLabel, 'Flagged post');
    assert.deepEqual(flagged.target, { resource: 'posts', id: 'p2' });
    assert.equal(flagged.reportCount, 0);
    assert.equal(flagged.reasonLabel, 'Looks like spam', 'a system row shows the moderation reason');
    assert.equal(flagged.reporter, null, 'no reporter: the screen shows Automatic review once');

    assert.equal(pendingWithReports.kind, 'pending');
    assert.equal(pendingWithReports.reportCount, 2);
    assert.equal(pendingWithReports.reasonLabel, 'Scam', 'the reason and reporter of the oldest report');
    assert.equal(pendingWithReports.reporter.name, 'Nour');
    assert.deepEqual(pendingWithReports.target, { resource: 'posts', id: 'p3' }, 'opens the review workspace');
  });

  it('shows no reason line for a system row without a moderation reason', async () => {
    const pool = fakePool();
    const original = pool.query.bind(pool);
    pool.query = async (sql, params) =>
      sql.includes('WITH cases(')
        ? {
            rows: [
              {
                kind: 'post',
                target_id: 'p2',
                case_id: null,
                report_count: 0,
                since: '2026-11-04T00:00:00Z',
                post_state: 'pending',
                total: 1,
              },
            ],
          }
        : sql.includes('FROM posts p')
          ? { rows: [{ target_id: 'p2', title: 'Quiet', photo: null, moderation_reason: null }] }
          : original(sql, params);
    const { items } = await loadInbox(pool, {});
    assert.equal(items[0].reasonLabel, null);
  });

  it('runs no detail query when the page is empty', async () => {
    const pool = {
      calls: 0,
      async query() {
        this.calls += 1;
        return { rows: [] };
      },
    };
    const inbox = await loadInbox(pool, {});
    assert.equal(pool.calls, 1);
    assert.deepEqual(inbox.items, []);
    assert.equal(inbox.total, 0);
    assert.equal(inbox.totalPages, 1);
  });
});
