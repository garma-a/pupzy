import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deletedLabel, excerpt, initials, referenceTitle, userDisplayName } from './reference-title.js';

const ID = '01a1d33a-e4e9-70c8-8d8f-8c4d78b4d161';

describe('userDisplayName', () => {
  it('prefers the English name, then the Arabic name, then email, then the short id', () => {
    assert.equal(userDisplayName({ full_name: 'Omar', full_name_arabic: 'عمر', email: 'o@x.test' }, ID), 'Omar');
    assert.equal(
      userDisplayName({ full_name: '  ', full_name_arabic: 'هنا إبراهيم', email: 'h@x.test' }, ID),
      'هنا إبراهيم',
    );
    assert.equal(userDisplayName({ full_name: null, full_name_arabic: null, email: 'h@x.test' }, ID), 'h@x.test');
    assert.equal(userDisplayName({}, ID), '01a1d33a…d161');
  });
});

describe('excerpt', () => {
  it('keeps short text, flattens whitespace and cuts long text to about 60 characters', () => {
    assert.equal(excerpt('Hello  there\nfriend'), 'Hello there friend');
    const long = excerpt('x'.repeat(200));
    assert.equal(long.length, 60);
    assert.ok(long.endsWith('…'));
    assert.equal(excerpt(null), '');
  });
});

describe('referenceTitle', () => {
  it('names each referenced record type readably', () => {
    assert.equal(referenceTitle('users', { full_name_arabic: 'هنا' }, ID), 'هنا');
    assert.equal(referenceTitle('admin_users', { full_name: 'Mona', email: 'm@x.test' }, ID), 'Mona');
    assert.equal(referenceTitle('posts', { title: 'Lost dog' }, ID), 'Lost dog');
    assert.equal(referenceTitle('comments', { text: 'Seen near the bridge' }, ID), 'Seen near the bridge');
    assert.equal(referenceTitle('comments', { text: '' }, ID), '01a1d33a…d161');
    assert.match(referenceTitle('contact_requests', {}, ID), /^Contact request 01a1d33a/);
  });

  it('uses the AdminJS title for other resources unless it is just the id', () => {
    assert.equal(referenceTitle('vet_clinics', {}, ID, 'Happy Paws'), 'Happy Paws');
    assert.equal(referenceTitle('vet_clinics', {}, ID, ID), '01a1d33a…d161');
  });
});

describe('deletedLabel', () => {
  it('says what kind of record is gone', () => {
    assert.equal(deletedLabel('users'), 'Deleted account');
    assert.equal(deletedLabel('posts'), 'Post not found');
    assert.equal(deletedLabel('comments'), 'Deleted comment');
    assert.equal(deletedLabel('something_else'), 'Deleted record');
  });
});

describe('initials', () => {
  it('takes up to two letters and copes with Arabic and empty names', () => {
    assert.equal(initials('Omar Hassan'), 'OH');
    assert.equal(initials('Omar'), 'OM');
    assert.equal(initials('هنا إبراهيم'), 'هإ');
    assert.equal(initials('  '), '?');
    assert.equal(initials(null), '?');
  });
});
