import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { buildPostsResource } from './posts.resource.js';
import { buildUsersResource } from './users.resource.js';
import { buildPostReportsResource } from './post-reports.resource.js';
import { buildContactRequestsResource } from './contact-requests.resource.js';
import { buildAdoptionApplicationsResource } from './adoption-applications.resource.js';
import { buildSavedSearchesResource } from './saved-searches.resource.js';
import { buildNotificationsResource } from './notifications.resource.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const themeCssPath = path.join(currentDir, '..', 'public', 'pupzy-theme.css');
const db = { table: (name) => ({ name }) };
const pool = {};
const components = {
  ShortUuid: 'ShortUuidMock',
  ModerationAction: 'ModerationActionMock',
};

describe('Moderation and Activity Tables Curation & Layout Rules (Task 10)', () => {
  const cssContent = fs.readFileSync(themeCssPath, 'utf-8');

  describe('Pupzy Theme CSS Table & Overflow Rules', () => {
    it('configures table wrappers for explicit horizontal overflow scrolling', () => {
      assert.match(cssContent, /overflow-x:\s*auto\s*!important/, 'Table wrappers must enable horizontal scrolling');
      assert.match(
        cssContent,
        /min-width:\s*600px/,
        'Tables must declare min-width to prevent character-by-character squeezing',
      );
    });

    it('enforces no-wrap on IDs, timestamps, enums, counts, badges, and action cells', () => {
      assert.match(cssContent, /td\[data-property-name\*=['"]id['"]\]/, 'IDs must be styled with no-wrap');
      assert.match(cssContent, /td\[data-property-name\*=['"]_at['"]\]/, 'Timestamps must be styled with no-wrap');
      assert.match(cssContent, /td\[data-property-name\*=['"]status['"]\]/, 'Statuses must be styled with no-wrap');
      assert.match(cssContent, /td\.adminjs_TableActionCell/, 'Action cell must be styled with no-wrap');
    });

    it('configures text truncation for list titles, emails, labels, details, and messages', () => {
      assert.match(
        cssContent,
        /td\[data-property-name=['"]title['"]\]/,
        'Titles must have text truncation rules in list view',
      );
      assert.match(
        cssContent,
        /text-overflow:\s*ellipsis\s*!important/,
        'List text cells must use ellipsis truncation',
      );
    });

    it('preserves full text wrapping on record show views', () => {
      assert.match(
        cssContent,
        /word-break:\s*break-word\s*!important/,
        'Show views must break words naturally without cutting off',
      );
      assert.match(cssContent, /white-space:\s*normal\s*!important/, 'Show views must allow multiline text');
    });

    it('configures Pupzy color badges for success, warning, and critical states', () => {
      assert.match(cssContent, /var\(--pupzy-success-light\)/);
      assert.match(cssContent, /var\(--pupzy-warning-light\)/);
      assert.match(cssContent, /var\(--pupzy-error-light\)/);
    });
  });

  describe('Moderation Resources Curation', () => {
    it('posts resource declares concise scan-oriented columns and ShortUuid', () => {
      const postsRes = buildPostsResource(db, pool, components);
      assert.deepEqual(postsRes.options.listProperties, [
        'id',
        'title',
        'post_type',
        'status',
        'moderation_status',
        'report_count',
        'created_at',
      ]);
      assert.ok(!postsRes.options.listProperties.includes('description'), 'description must not be in listProperties');
      assert.ok(!postsRes.options.listProperties.includes('coordinates'), 'coordinates must not be in listProperties');
      assert.equal(postsRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(postsRes.options.properties.creator_id.components.show, 'ShortUuidMock');
    });

    it('users resource declares concise scan-oriented columns and ShortUuid', () => {
      const usersRes = buildUsersResource(db, pool, components);
      assert.deepEqual(usersRes.options.listProperties, [
        'id',
        'email',
        'full_name',
        'is_verified',
        'is_banned',
        'post_count',
        'created_at',
      ]);
      assert.equal(usersRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(usersRes.options.properties.banned_by_admin_id.components.show, 'ShortUuidMock');
    });

    it('post_reports resource exposes moderation context without long details in list', () => {
      const reportsRes = buildPostReportsResource(db, components);
      assert.deepEqual(reportsRes.options.listProperties, ['id', 'post_id', 'reporter_id', 'reason', 'created_at']);
      assert.ok(!reportsRes.options.listProperties.includes('details'));
      assert.ok(reportsRes.options.showProperties.includes('details'));
      assert.equal(reportsRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(reportsRes.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(reportsRes.options.properties.reporter_id.components.list, 'ShortUuidMock');
    });
  });

  describe('User Activity Resources Curation', () => {
    it('contact_requests resource uses concise columns and ShortUuid', () => {
      const contactRes = buildContactRequestsResource(db, components);
      assert.deepEqual(contactRes.options.listProperties, [
        'id',
        'post_id',
        'requester_id',
        'status',
        'responded_at',
        'created_at',
      ]);
      assert.ok(!contactRes.options.listProperties.includes('message'));
      assert.ok(contactRes.options.showProperties.includes('message'));
      assert.equal(contactRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(contactRes.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(contactRes.options.properties.requester_id.components.list, 'ShortUuidMock');
    });

    it('adoption_applications resource uses concise columns and ShortUuid', () => {
      const adoptRes = buildAdoptionApplicationsResource(db, components);
      assert.deepEqual(adoptRes.options.listProperties, [
        'id',
        'target_post_id',
        'applicant_id',
        'status',
        'living_situation',
        'created_at',
      ]);
      assert.ok(!adoptRes.options.listProperties.includes('why_adopt'));
      assert.ok(adoptRes.options.showProperties.includes('why_adopt'));
      assert.equal(adoptRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(adoptRes.options.properties.target_post_id.components.list, 'ShortUuidMock');
      assert.equal(adoptRes.options.properties.applicant_id.components.list, 'ShortUuidMock');
    });

    it('saved_searches resource uses intentional columns, readable City and ShortUuid', () => {
      const savedRes = buildSavedSearchesResource(db, components);
      assert.deepEqual(savedRes.options.listProperties, [
        'id',
        'user_id',
        'label',
        'post_type',
        'city_id',
        'species',
        'created_at',
      ]);
      assert.ok(savedRes.options.showProperties.includes('breed'));
      assert.ok(savedRes.options.showProperties.includes('market_category'));
      assert.equal(savedRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(savedRes.options.properties.user_id.components.list, 'ShortUuidMock');
    });

    it('notifications resource uses intentional columns and ShortUuid', () => {
      const notifRes = buildNotificationsResource(db, components);
      assert.deepEqual(notifRes.options.listProperties, [
        'id',
        'recipient_id',
        'type',
        'title',
        'is_read',
        'created_at',
      ]);
      assert.ok(!notifRes.options.listProperties.includes('body'));
      assert.ok(notifRes.options.showProperties.includes('body'));
      assert.equal(notifRes.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(notifRes.options.properties.recipient_id.components.list, 'ShortUuidMock');
    });
  });

  describe('Security and Privacy Posture across Moderation & Activity Resources', () => {
    const resources = [
      buildPostsResource(db, pool, components),
      buildUsersResource(db, pool, components),
      buildPostReportsResource(db, components),
      buildContactRequestsResource(db, components),
      buildAdoptionApplicationsResource(db, components),
      buildSavedSearchesResource(db, components),
      buildNotificationsResource(db, components),
    ];

    it('all resources disable destructive delete and bulkDelete actions', () => {
      for (const res of resources) {
        assert.equal(res.options.actions.delete.isAccessible, false, `${res.resource.name} must disable delete`);
        assert.equal(
          res.options.actions.bulkDelete.isAccessible,
          false,
          `${res.resource.name} must disable bulkDelete`,
        );
      }
    });

    it('all resources attach password hash / private field stripping to list and show hooks', () => {
      for (const res of resources) {
        const listAfter = res.options.actions.list?.after;
        const showAfter = res.options.actions.show?.after;
        assert.ok(
          typeof listAfter === 'function' || Array.isArray(listAfter),
          `${res.resource.name} must have list after hook`,
        );
        assert.ok(
          typeof showAfter === 'function' || Array.isArray(showAfter),
          `${res.resource.name} must have show after hook`,
        );
      }
    });
  });
});
