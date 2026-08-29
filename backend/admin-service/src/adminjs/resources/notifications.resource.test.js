import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildNotificationsResource } from './notifications.resource.js';

const mockDb = {
  table: (name) => ({ name }),
};

describe('Notifications Resource Configuration', () => {
  it('declares concise intentional list properties excluding large body text and secondary foreign keys', () => {
    const resource = buildNotificationsResource(mockDb);
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'recipient_id',
      'type',
      'title',
      'is_read',
      'created_at',
    ]);
    assert.equal(
      resource.options.listProperties.includes('body'),
      false,
      'body must be excluded from listProperties to prevent vertical character wrapping',
    );
  });

  it('preserves full body and complete entity relationships on record show view', () => {
    const resource = buildNotificationsResource(mockDb);
    assert.deepEqual(resource.options.showProperties, [
      'id',
      'recipient_id',
      'type',
      'title',
      'body',
      'related_post_id',
      'related_contact_request_id',
      'related_application_id',
      'is_read',
      'created_at',
    ]);
  });

  it('attaches ShortUuid custom component to ID fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent' };
    const resource = buildNotificationsResource(mockDb, components);
    assert.equal(resource.options.properties.id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.id.components.show, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.recipient_id.components.list, 'CustomShortUuidComponent');
    assert.equal(resource.options.properties.related_post_id.components.show, 'CustomShortUuidComponent');
  });

  it('enforces read-only actions (disables new, edit, delete, bulkDelete)', () => {
    const resource = buildNotificationsResource(mockDb);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it('transcribes notification type enum values exactly', () => {
    const resource = buildNotificationsResource(mockDb);
    const available = resource.options.properties.type.availableValues.map((v) => v.value);
    assert.deepEqual(available, ENUMS.notificationType);
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const resource = buildNotificationsResource(mockDb);
    const showAfter = resource.options.actions.show.after;
    const response = {
      record: {
        params: { id: 'notif-1' },
        populated: {
          recipient_id: {
            params: { id: 'user-1', password_hash: 'secret_hash' },
          },
        },
      },
    };
    const cleaned = showAfter(response);
    assert.equal(cleaned.record.populated.recipient_id.params.password_hash, undefined);
  });
});
