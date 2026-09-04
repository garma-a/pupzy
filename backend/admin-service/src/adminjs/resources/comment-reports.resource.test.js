import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildCommentReportsResource } from './comment-reports.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Comment Reports Resource Configuration', () => {
  it('declares concise intentional listProperties excluding heavy details', () => {
    const resource = buildCommentReportsResource(db);
    assert.deepEqual(resource.options.listProperties, ['id', 'comment_id', 'reporter_id', 'reason', 'created_at']);
    assert.equal(
      resource.options.listProperties.includes('details'),
      false,
      'details must be excluded from listProperties to prevent vertical wrapping',
    );
  });

  it('preserves full report details on record show view', () => {
    const resource = buildCommentReportsResource(db);
    assert.deepEqual(resource.options.showProperties, [
      'id',
      'comment_id',
      'reporter_id',
      'reason',
      'details',
      'created_at',
    ]);
  });

  it('attaches ShortUuid custom component to ID and relation fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent' };
    const resource = buildCommentReportsResource(db, components);
    assert.equal(resource.options.properties.id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.comment_id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.comment_id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.reporter_id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.reporter_id.components.show, 'CustomShortUuidComponent');
  });

  it('enforces read-only actions (disables new, edit, delete, bulkDelete)', () => {
    const resource = buildCommentReportsResource(db);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const resource = buildCommentReportsResource(db);
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

  it('transcribes report reason enum values exactly', () => {
    const resource = buildCommentReportsResource(db);
    const available = resource.options.properties.reason.availableValues.map((v) => v.value);
    assert.deepEqual(available, ENUMS.reportReason);
  });
});
