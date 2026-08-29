import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildContactRequestsResource } from './contact-requests.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Contact Requests Resource Configuration', () => {
  it('declares concise intentional listProperties excluding long message bodies', () => {
    const resource = buildContactRequestsResource(db);
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'post_id',
      'requester_id',
      'status',
      'responded_at',
      'created_at',
    ]);
    assert.equal(
      resource.options.listProperties.includes('message'),
      false,
      'message must be excluded from listProperties to prevent vertical wrapping',
    );
  });

  it('preserves full message body and relationships on record show view', () => {
    const resource = buildContactRequestsResource(db);
    assert.deepEqual(resource.options.showProperties, [
      'id',
      'post_id',
      'requester_id',
      'status',
      'message',
      'responded_at',
      'created_at',
    ]);
  });

  it('attaches ShortUuid custom component to ID and relation fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent' };
    const resource = buildContactRequestsResource(db, components);
    assert.equal(resource.options.properties.id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.post_id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.post_id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.requester_id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.requester_id.components.show, 'CustomShortUuidComponent');
  });

  it('enforces read-only actions (disables new, edit, delete, bulkDelete)', () => {
    const resource = buildContactRequestsResource(db);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const resource = buildContactRequestsResource(db);
    const showAfter = resource.options.actions.show.after;
    const response = {
      record: {
        params: { id: 'request-1' },
        populated: {
          requester_id: {
            params: { id: 'user-1', password_hash: 'secret_hash' },
          },
        },
      },
    };
    const cleaned = showAfter(response);
    assert.equal(cleaned.record.populated.requester_id.params.password_hash, undefined);
  });

  it('transcribes request status enum values exactly', () => {
    const resource = buildContactRequestsResource(db);
    const available = resource.options.properties.status.availableValues.map((v) => v.value);
    assert.deepEqual(available, ENUMS.requestStatus);
  });
});
