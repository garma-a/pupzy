import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { caseHref, headingCounts, inboxSearch, relativeAge, reportCountLabel } from './inbox-format.js';
import { safeReturnPath } from '../components/list-return.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('Inbox formatting', () => {
  it('words the age of a case', () => {
    assert.equal(relativeAge(ago(10_000), NOW), 'Just now');
    assert.equal(relativeAge(ago(5 * 60_000), NOW), '5 min ago');
    assert.equal(relativeAge(ago(2 * 3_600_000 + 5 * 60_000), NOW), '2 h ago');
    assert.equal(relativeAge(ago(3 * 86_400_000), NOW), '3 d ago');
    assert.equal(relativeAge(ago(-60_000), NOW), 'Just now', 'a clock skew never reads as the future');
    assert.equal(relativeAge('not a date', NOW), '');
  });

  it('counts reports in words', () => {
    assert.equal(reportCountLabel(0), 'No reports');
    assert.equal(reportCountLabel(1), '1 report');
    assert.equal(reportCountLabel(3), '3 reports');
  });

  it('keeps defaults out of the Inbox query', () => {
    assert.equal(inboxSearch(), '');
    assert.equal(inboxSearch({ kind: 'all', order: 'oldest', page: 1 }), '');
    assert.equal(inboxSearch({ kind: 'flagged', order: 'newest', page: 3 }), '?kind=flagged&order=newest&page=3');
  });

  it('opens a case with a return path that is accepted as safe', () => {
    const inbox = `/admin${inboxSearch({ kind: 'post_report', page: 2 })}`;
    const href = caseHref({ resource: 'post_reports', id: 'abc-1' }, inbox);
    assert.match(href, /^\/admin\/resources\/post_reports\/records\/abc-1\/show\?returnTo=/);
    const returnTo = new URL(href, 'http://x').searchParams.get('returnTo');
    assert.equal(returnTo, inbox);
    assert.equal(safeReturnPath(returnTo), inbox);
    assert.equal(
      caseHref({ resource: 'posts', id: 'p 1' }, '/admin', '/panel').startsWith(
        '/panel/resources/posts/records/p%201/show',
      ),
      true,
    );
  });

  it('words the heading counts: cases and reports for a report tile, cases otherwise', () => {
    assert.equal(headingCounts({ reports: true, cases: 4, reportCount: 5 }), '4 cases, 5 reports');
    assert.equal(headingCounts({ reports: true, cases: 1, reportCount: 1 }), '1 case, 1 report');
    assert.equal(headingCounts({ reports: false, cases: 3 }), '3');
    assert.equal(headingCounts({ cases: 16 }), '16');
  });
});
