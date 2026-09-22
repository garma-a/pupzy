import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildAccountReportsResource } from './account-reports.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Account Reports Resource Configuration', () => {
  it('declares concise intentional listProperties excluding heavy details', () => {
    const resource = buildAccountReportsResource(db);
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'reporter_id',
      'reported_user_id',
      'reason',
      'source_type',
      'reviewed_at',
      'created_at',
    ]);
    assert.equal(
      resource.options.listProperties.includes('details'),
      false,
      'details must be excluded from listProperties to prevent vertical wrapping',
    );
  });

  it('exposes open-report review state and validated source context on record show', () => {
    const resource = buildAccountReportsResource(db);
    for (const property of [
      'details',
      'source_type',
      'source_id',
      'reviewed_at',
      'reviewed_by_admin_id',
      'review_outcome',
    ]) {
      assert.ok(
        resource.options.showProperties.includes(property),
        `${property} must be inspectable on the record show view`,
      );
    }
  });

  it('supports filtering by review state and source type for the open queue', () => {
    const resource = buildAccountReportsResource(db);
    assert.ok(resource.options.filterProperties.includes('reviewed_at'));
    assert.ok(resource.options.filterProperties.includes('source_type'));
    assert.ok(resource.options.filterProperties.includes('review_state'));
    assert.deepEqual(
      resource.options.properties.review_state.availableValues.map(({ value }) => value),
      ['OPEN', 'REVIEWED'],
    );
  });

  it('attaches ShortUuid custom component to ID and relation fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent' };
    const resource = buildAccountReportsResource(db, components);
    for (const field of ['id', 'reporter_id', 'reported_user_id', 'source_id', 'reviewed_by_admin_id']) {
      assert.equal(resource.options.properties[field].components.list, 'CustomShortUuidComponent');
      assert.equal(resource.options.properties[field].components.show, 'CustomShortUuidComponent');
    }
  });

  it('enforces read-only actions (disables new, edit, delete, bulkDelete)', () => {
    const resource = buildAccountReportsResource(db);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const resource = buildAccountReportsResource(db);
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

  it('exposes the reviewed-with-no-action outcome for open reports', () => {
    const resource = buildAccountReportsResource(db);
    const action = resource.options.actions.reviewWithNoAction;
    assert.ok(action, 'account reports must allow an explicit no-action review');
    assert.equal(action.isAccessible({ currentAdmin: { id: 'admin-1', role: 'ADMIN' } }), true);
    assert.equal(action.isVisible({ record: { params: { reviewed_at: null } } }), true);
    assert.equal(action.isVisible({ record: { params: { reviewed_at: new Date() } } }), false);
    assert.equal(action.isVisible({ record: { params: {} } }), true);
    assert.equal(action.isVisible({}), false);
  });

  it('transcribes account report enums exactly', () => {
    const resource = buildAccountReportsResource(db);
    assert.deepEqual(
      resource.options.properties.reason.availableValues.map((v) => v.value),
      ENUMS.accountReportReason,
    );
    assert.deepEqual(
      resource.options.properties.source_type.availableValues.map((v) => v.value),
      ENUMS.accountReportSourceType,
    );
    assert.deepEqual(
      resource.options.properties.review_outcome.availableValues.map((v) => v.value),
      ENUMS.accountReportReviewOutcome,
    );
  });
});
