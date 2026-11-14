import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachPopulatedSanitizer, sanitizePopulatedRecords } from './resource-helpers.js';

const userParams = () => ({
  id: 'u1',
  email: 'a@x.test',
  full_name: 'Omar',
  full_name_arabic: 'عمر',
  profile_picture_url: 'https://cdn/x.png',
  is_banned: false,
  phone_number: '+201000000000',
  last_known_location: '0101000020E6100000',
  firebase_user_id: 'fb',
});

const context = {
  resource: {
    properties: () => [
      { name: () => 'reporter_id', reference: () => 'users' },
      { name: () => 'reviewed_by_admin_id', reference: () => 'admin_users' },
      { name: () => 'post_id', reference: () => 'posts' },
      { name: () => 'reason', reference: () => null },
    ],
  },
};

describe('populated reference sanitizer', () => {
  it('keeps only what a reference needs from a populated user and admin', () => {
    const response = {
      records: [
        {
          params: {},
          populated: {
            reporter_id: { params: userParams() },
            reviewed_by_admin_id: {
              params: { id: 'a1', email: 'm@x.test', full_name: 'Mona', password_hash: 'h', role: 'ADMIN' },
            },
            post_id: { params: { id: 'p1', title: 'Post', password_hash: 'h' } },
          },
        },
      ],
    };
    sanitizePopulatedRecords(response, {}, context);
    const { reporter_id: user, reviewed_by_admin_id: admin, post_id: post } = response.records[0].populated;
    assert.deepEqual(Object.keys(user.params).sort(), [
      'email',
      'full_name',
      'full_name_arabic',
      'id',
      'is_banned',
      'profile_picture_url',
    ]);
    assert.equal(admin.params.password_hash, undefined);
    assert.equal(admin.params.full_name, 'Mona');
    assert.equal(post.params.title, 'Post');
    assert.equal(post.params.password_hash, undefined);
  });

  it('cleans a show record, nested populated records and entries that name their resource', () => {
    const response = {
      record: {
        params: {},
        populated: {
          source_id: { resourceId: 'users', params: userParams() },
          reporter_id: { params: { ...userParams(), id: 'u2' }, populated: { home_city_id: { params: { id: 'c' } } } },
        },
      },
    };
    sanitizePopulatedRecords(response, {}, context);
    assert.equal(response.record.populated.source_id.params.phone_number, undefined);
    assert.equal(response.record.populated.reporter_id.params.last_known_location, undefined);
    assert.equal(response.record.populated.reporter_id.populated.home_city_id.params.id, 'c');
  });

  it('runs last on list, show, search and edit unless the action is disabled', () => {
    const marker = () => {};
    const resource = attachPopulatedSanitizer({
      options: { actions: { list: { after: marker }, show: { after: [marker] }, edit: { isAccessible: false } } },
    });
    assert.deepEqual(resource.options.actions.list.after, [marker, sanitizePopulatedRecords]);
    assert.deepEqual(resource.options.actions.show.after, [marker, sanitizePopulatedRecords]);
    assert.deepEqual(resource.options.actions.search.after, [sanitizePopulatedRecords]);
    assert.equal(resource.options.actions.edit.after, undefined);
  });
});
