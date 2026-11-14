import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAccountReportTargetActions,
  buildCommentReportTargetActions,
  buildPostReportTargetActions,
  reportTargetState,
  withTargetState,
} from './report-target-actions.js';

const record = (params) => ({
  id: () => 'report-1',
  params,
  toJSON: () => ({ id: 'report-1' }),
});
const visible = (action, params) => action.isVisible({ record: record(params) });
const h = {
  recordActionUrl: ({ resourceId, recordId, actionName, search = '' }) =>
    `/admin/resources/${resourceId}/records/${recordId}/${actionName}${search}`,
};

describe('actions on the reported content from a report page', () => {
  it('shows Remove Post and Ban Author on a Post Report only while they apply', () => {
    const { removePost, banAuthor } = buildPostReportTargetActions();
    const base = { report_target_id: 'p1', report_target_status: 'ACTIVE', report_target_author_id: 'u1' };
    assert.equal(visible(removePost, base), true);
    assert.equal(visible(removePost, { ...base, report_target_status: 'REMOVED' }), false, 'already removed');
    assert.equal(visible(removePost, {}), false, 'target state not loaded');
    assert.equal(visible(banAuthor, base), true);
    assert.equal(visible(banAuthor, { ...base, report_target_author_banned: true }), false, 'already banned');
    assert.equal(visible(banAuthor, { ...base, report_target_author_id: null }), false);
  });

  it('shows Hide Comment, Remove Comment and Ban Author on a Comment Report by the Comment state', () => {
    const { hideComment, removeComment, banAuthor } = buildCommentReportTargetActions();
    const at = (status) => ({ report_target_id: 'c1', report_target_status: status, report_target_author_id: 'u1' });
    assert.deepEqual(
      ['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'REMOVED'].map((status) => visible(hideComment, at(status))),
      [true, true, false, false],
    );
    assert.deepEqual(
      ['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'REMOVED'].map((status) => visible(removeComment, at(status))),
      [true, true, true, false],
    );
    assert.equal(visible(banAuthor, at('ACTIVE')), true);
    assert.equal(visible(banAuthor, { ...at('ACTIVE'), report_target_author_banned: true }), false);
  });

  it('shows Ban User on an Account Report until the account is banned', () => {
    const { banUser } = buildAccountReportTargetActions();
    assert.equal(visible(banUser, { report_target_author_id: 'u1', report_target_author_banned: false }), true);
    assert.equal(visible(banUser, { report_target_author_id: 'u1', report_target_author_banned: true }), false);
  });

  it("only redirects to the target's own action form with the report as the return target", async () => {
    const { removePost, banAuthor } = buildPostReportTargetActions();
    const params = { report_target_id: 'post-9', report_target_author_id: 'user-4' };
    const result = await removePost.handler({ method: 'get' }, {}, { record: record(params), currentAdmin: {}, h });
    const returnTo = encodeURIComponent('/admin/resources/post_reports/records/report-1/show');
    assert.equal(result.redirectUrl, `/admin/resources/posts/records/post-9/removePost?returnTo=${returnTo}`);
    const ban = await banAuthor.handler({ method: 'get' }, {}, { record: record(params), currentAdmin: {}, h });
    assert.equal(ban.redirectUrl, `/admin/resources/users/records/user-4/banUser?returnTo=${returnTo}`);
    assert.equal(removePost.component, false);
    assert.equal(removePost.guard, undefined);
  });

  it('loads the target state before the record actions are listed and adds the hook to every action', async () => {
    const pool = {
      query: async () => ({
        rows: [{ target_id: 'p1', target_status: 'ACTIVE', author_id: 'u1', author_banned: false }],
      }),
    };
    const hook = reportTargetState(pool, 'post');
    const target = record({});
    await hook({}, { record: target });
    assert.deepEqual(target.params, {
      report_target_id: 'p1',
      report_target_status: 'ACTIVE',
      report_target_author_id: 'u1',
      report_target_author_banned: false,
    });
    const wrapped = withTargetState({ show: { after: [] }, other: { before: () => {} } }, hook);
    assert.equal(wrapped.show.before.at(-1), hook);
    assert.equal(wrapped.other.before.length, 2);
  });
});
