import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildPostReportsResource } from './post-reports.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Post Reports Resource Configuration', () => {
  it('declares concise intentional listProperties excluding heavy details', () => {
    const resource = buildPostReportsResource(db);
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'review_status',
      'post_id',
      'reporter_id',
      'reason',
      'reviewed_at',
      'created_at',
    ]);
    assert.equal(
      resource.options.listProperties.includes('details'),
      false,
      'details must be excluded from listProperties to prevent vertical wrapping',
    );
  });

  it('preserves full report details and review outcome on record show view', () => {
    const resource = buildPostReportsResource(db);
    assert.deepEqual(resource.options.showProperties, [
      'review_status',
      'id',
      'post_id',
      'reporter_id',
      'reason',
      'details',
      'reviewed_at',
      'reviewed_by_admin_id',
      'review_outcome',
      'created_at',
    ]);
  });

  it('exposes the reviewed-with-no-action outcome for open reports', () => {
    const resource = buildPostReportsResource(db);
    const action = resource.options.actions.reviewWithNoAction;
    assert.ok(action, 'post reports must allow an explicit no-action review');
    assert.equal(action.isAccessible({ currentAdmin: { id: 'admin-1', role: 'ADMIN' } }), true);
    assert.equal(action.isVisible({ record: { params: { reviewed_at: null } } }), true);
    assert.equal(action.isVisible({ record: { params: { reviewed_at: new Date() } } }), false);
    assert.equal(action.isVisible({ record: { params: {} } }), true);
    assert.equal(action.isVisible({}), false);
  });

  it('attaches ShortUuid custom component to ID and relation fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent', ReferenceLink: 'CustomReferenceLinkComponent' };
    const resource = buildPostReportsResource(db, components);
    assert.equal(resource.options.properties.id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.post_id.components.list, 'CustomReferenceLinkComponent');
    assert.equal(resource.options.properties.post_id.components.show, 'CustomReferenceLinkComponent');
    assert.equal(resource.options.properties.reporter_id.components.list, 'CustomReferenceLinkComponent');
    assert.equal(resource.options.properties.reporter_id.components.show, 'CustomReferenceLinkComponent');
  });

  it('enforces read-only actions (disables new, edit, delete, bulkDelete)', () => {
    const resource = buildPostReportsResource(db);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const resource = buildPostReportsResource(db);
    const showAfter = resource.options.actions.show.after;
    const response = {
      record: {
        params: { id: 'report-1' },
        populated: {
          reporter_id: {
            params: { id: 'user-1', password_hash: 'secret_hash' },
          },
        },
      },
    };
    const cleaned = showAfter(response);
    assert.equal(cleaned.record.populated.reporter_id.params.password_hash, undefined);
  });

  it('exposes an open/reviewed queue filter distinct from the reviewed_at range filter', () => {
    const resource = buildPostReportsResource(db);
    assert.ok(resource.options.filterProperties.includes('review_state'));
    assert.deepEqual(
      resource.options.properties.review_state.availableValues.map(({ value }) => value),
      ['OPEN', 'REVIEWED'],
    );
    assert.deepEqual(resource.options.properties.review_state.isVisible, {
      list: false,
      show: false,
      edit: false,
      filter: true,
    });
  });

  it('transcribes report reason enum values exactly', () => {
    const resource = buildPostReportsResource(db);
    const available = resource.options.properties.reason.availableValues.map((v) => v.value);
    assert.deepEqual(available, ENUMS.reportReason);
  });

  it('transcribes the Post Report review outcome vocabulary exactly', () => {
    const resource = buildPostReportsResource(db);
    const available = resource.options.properties.review_outcome.availableValues.map((v) => v.value);
    assert.deepEqual(available, ENUMS.postReportReviewOutcome);
    assert.deepEqual(available, ENUMS.accountReportReviewOutcome);
  });
});

describe('Report review status column', () => {
  it('is a read-only Status at the top of the show page and in the list for all three report resources', async () => {
    const { buildCommentReportsResource } = await import('./comment-reports.resource.js');
    const { buildAccountReportsResource } = await import('./account-reports.resource.js');
    const components = { ReportStatus: 'ReportStatusMock' };
    for (const build of [buildPostReportsResource, buildCommentReportsResource, buildAccountReportsResource]) {
      const resource = build(db, components);
      assert.equal(resource.options.showProperties[0], 'review_status');
      assert.ok(resource.options.listProperties.includes('review_status'));
      const property = resource.options.properties.review_status;
      assert.equal(property.isSortable, false);
      assert.equal(property.isDisabled, true);
      assert.equal(property.components.list, 'ReportStatusMock');
      assert.equal(property.components.show, 'ReportStatusMock');
      assert.equal(resource.options.filterProperties.includes('review_status'), false);
    }
  });
});
