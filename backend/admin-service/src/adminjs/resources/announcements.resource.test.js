import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { ANNOUNCEMENT_PROPERTY_LABELS, buildAnnouncementsResource } from './announcements.resource.js';

const db = { table: (name) => ({ name }) };
const pool = {};
const components = {
  ShortUuid: 'ShortUuid',
  ReferenceLink: 'ReferenceLink',
  RecordStatus: 'RecordStatus',
  AnnouncementCompose: 'AnnouncementCompose',
  AnnouncementShow: 'AnnouncementShow',
  AnnouncementText: 'AnnouncementText',
  AnnouncementAudience: 'AnnouncementAudience',
  AnnouncementPush: 'AnnouncementPush',
};

const superAdmin = { currentAdmin: { id: 'a1', role: 'SUPER_ADMIN' } };
const staff = { currentAdmin: { id: 'a2', role: 'ADMIN' } };

describe('Announcements resource', () => {
  const resource = buildAnnouncementsResource(db, pool, components);
  const { actions } = resource.options;

  it('is registered on the announcements table as its own top-level navigation entry', () => {
    assert.equal(resource.resource.name, 'announcements');
    assert.equal(resource.options.navigation.name, null);
    assert.equal(resource.options.navigation.icon, 'Bell');
  });

  it('lets only a super admin use every action, and a plain admin none of them', () => {
    for (const name of ['list', 'search', 'show', 'new', 'previewAnnouncement']) {
      assert.equal(typeof actions[name].isAccessible, 'function', `${name} needs a role check`);
      assert.equal(actions[name].isAccessible(superAdmin), true, `${name} for a super admin`);
      assert.equal(actions[name].isAccessible(staff), false, `${name} for a plain admin`);
      assert.equal(actions[name].isAccessible({}), false, `${name} without a session`);
    }
  });

  it('cannot be edited or deleted after it is sent', () => {
    for (const name of ['edit', 'delete', 'bulkDelete']) {
      assert.equal(actions[name].isAccessible, false, name);
    }
  });

  it('shows the history with sender, time, audience, both texts, status and counts', () => {
    assert.deepEqual(resource.options.listProperties, [
      'created_at',
      'sent_by_admin_id',
      'audience',
      'title_en',
      'title_ar',
      'status',
      'expected_recipients',
      'in_app_count',
      'push_intent_count',
    ]);
    assert.equal(resource.options.properties.title_en.components.list, 'AnnouncementText');
    assert.equal(resource.options.properties.title_ar.components.list, 'AnnouncementText');
    assert.equal(resource.options.properties.audience.components.list, 'AnnouncementAudience');
    assert.equal(resource.options.properties.push_intent_count.components.list, 'AnnouncementPush');
    assert.equal(resource.options.properties.sent_by_admin_id.components.list, 'ReferenceLink');
    assert.deepEqual(resource.options.sort, { sortBy: 'created_at', direction: 'desc' });
  });

  it('labels the columns in plain words', () => {
    const properties = resource.options.properties;
    assert.equal(properties.title_en.label, 'English');
    assert.equal(properties.title_ar.label, 'Arabic');
    assert.equal(properties.expected_recipients.label, 'Recipients');
    assert.equal(properties.in_app_count.label, 'In-app');
    assert.equal(properties.push_intent_count.label, 'Push');
    assert.equal(properties.sent_by_admin_id.label, 'Sent by');
  });

  it('registers the same labels as translations so table headers use them', () => {
    for (const [name, label] of Object.entries(ANNOUNCEMENT_PROPERTY_LABELS)) {
      assert.equal(resource.options.properties[name].label, label, name);
    }
  });

  it('uses the compose component for New announcement and the detail component for show', () => {
    assert.equal(actions.new.component, 'AnnouncementCompose');
    assert.equal(actions.new.label, 'New announcement');
    assert.equal(actions.show.component, 'AnnouncementShow');
    assert.equal(actions.previewAnnouncement.actionType, 'resource');
    assert.equal(actions.previewAnnouncement.isVisible, false);
  });

  it('transcribes the status and audience values exactly', () => {
    const values = (name) => resource.options.properties[name].availableValues.map(({ value }) => value);
    assert.deepEqual(values('status'), ENUMS.announcementStatus);
    assert.deepEqual(values('audience'), ENUMS.announcementAudience);
    assert.deepEqual(ENUMS.announcementStatus, ['PENDING', 'SENDING', 'SENT', 'FAILED']);
  });
});
