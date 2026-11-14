import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_RESOURCE_TABLES } from './index.js';
import { NAV_GROUPS, RESOURCE_LABELS, buildNavigation, navigationFor, withResourceLabels } from './navigation.js';

const resource = (id, extra = {}) => ({ id, href: `/admin/resources/${id}`, ...extra });

describe('Admin navigation', () => {
  it('groups the sidebar by task in the agreed order', () => {
    assert.deepEqual(
      NAV_GROUPS.map((group) => group.name),
      ['Reports', 'Content', 'People', 'Places', 'Announcements', 'Admin', 'Records'],
    );
    assert.deepEqual(NAV_GROUPS[0].resources, ['post_reports', 'comment_reports', 'account_reports']);
    assert.deepEqual(NAV_GROUPS[1].resources, ['posts', 'comments', 'post_media']);
    assert.deepEqual(NAV_GROUPS[3].resources, ['cities', 'vet_clinics']);
    assert.deepEqual(NAV_GROUPS[5].resources, ['admin_users', 'moderation_actions', 'notifications']);
    assert.equal(NAV_GROUPS.find((group) => group.name === 'Records').collapsedByDefault, true);
    assert.equal(NAV_GROUPS.filter((group) => group.collapsedByDefault).length, 1);
  });

  it('places every admin resource in exactly one group and gives it a plain name', () => {
    const placed = NAV_GROUPS.flatMap((group) => group.resources);
    assert.equal(new Set(placed).size, placed.length, 'no resource in two groups');
    assert.deepEqual([...placed].sort(), [...ADMIN_RESOURCE_TABLES].sort());
    for (const id of ADMIN_RESOURCE_TABLES) {
      assert.ok(RESOURCE_LABELS[id], `${id} has a plain label`);
      assert.doesNotMatch(RESOURCE_LABELS[id], /_/, `${id} label has no raw column style`);
    }
  });

  it('sets the resource navigation option from the same list', () => {
    assert.deepEqual(navigationFor('post_reports'), { name: 'Reports', icon: 'Flag' });
    assert.deepEqual(navigationFor('announcements'), { name: null, icon: 'Bell' });
    assert.equal(navigationFor('nonsense'), undefined);
    const merged = withResourceLabels({ posts: { actions: { list: 'Posts' } } });
    assert.equal(merged.moderation_actions.labels.moderation_actions, 'Audit log');
    assert.equal(merged.posts.actions.list, 'Posts', 'existing translations are kept');
  });

  it('hides resources the admin cannot open and drops groups left empty', () => {
    const all = ADMIN_RESOURCE_TABLES.map((id) => resource(id));
    const asAdmin = all.map((r) => (['announcements', 'admin_users'].includes(r.id) ? { id: r.id } : r));
    const groups = buildNavigation(asAdmin);
    assert.ok(!groups.some((group) => group.name === 'Announcements'), 'Announcements hidden from admins');
    assert.deepEqual(
      groups.find((group) => group.name === 'Admin').items.map((item) => item.id),
      ['moderation_actions', 'notifications'],
    );
    assert.equal(buildNavigation(all).length, 7);
  });
});
