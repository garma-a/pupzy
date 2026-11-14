import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROPERTY_LABELS } from './property-labels.js';
import { buildAccountReportsResource } from './resources/account-reports.resource.js';
import { buildAdoptionApplicationsResource } from './resources/adoption-applications.resource.js';
import { buildAdoptionPostsResource } from './resources/adoption-posts.resource.js';
import { buildCommentReportsResource } from './resources/comment-reports.resource.js';
import { buildCommentsResource } from './resources/comments.resource.js';
import { buildContactRequestsResource } from './resources/contact-requests.resource.js';
import { buildLostPostsResource } from './resources/lost-posts.resource.js';
import { buildMatingPostsResource } from './resources/mating-posts.resource.js';
import { buildModerationActionsResource } from './resources/moderation-actions.resource.js';
import { buildNotificationsResource } from './resources/notifications.resource.js';
import { buildPostMediaResource } from './resources/post-media.resource.js';
import { buildPostReportsResource } from './resources/post-reports.resource.js';
import { buildPostSavesResource } from './resources/post-saves.resource.js';
import { buildPostUpvotesResource } from './resources/post-upvotes.resource.js';
import { buildPostsResource } from './resources/posts.resource.js';
import { buildProductPostsResource } from './resources/product-posts.resource.js';
import { buildRescuePostsResource } from './resources/rescue-posts.resource.js';
import { buildUsersResource } from './resources/users.resource.js';
import { buildVetClinicLocationAuditsResource } from './resources/vet-clinic-location-audits.resource.js';

const db = { table: (name) => ({ name }) };
const pool = { query: async () => ({ rows: [] }) };
const components = { ShortUuid: 'ShortUuidMock', ReferenceLink: 'ReferenceLinkMock', ModerationAction: 'Form' };

const resources = {
  post_reports: buildPostReportsResource(db, components, pool),
  comment_reports: buildCommentReportsResource(db, components, pool),
  account_reports: buildAccountReportsResource(db, components, pool),
  comments: buildCommentsResource(db, pool, components),
  post_media: buildPostMediaResource(db, components),
  post_saves: buildPostSavesResource(db, components),
  post_upvotes: buildPostUpvotesResource(db, components),
  notifications: buildNotificationsResource(db, components),
  moderation_actions: buildModerationActionsResource(db, components, pool),
  contact_requests: buildContactRequestsResource(db, components),
  adoption_applications: buildAdoptionApplicationsResource(db, components),
  vet_clinic_location_audits: buildVetClinicLocationAuditsResource(db, components),
  posts: buildPostsResource(db, pool, components),
  users: buildUsersResource(db, pool, components),
  rescue_posts: buildRescuePostsResource(db, components),
  lost_posts: buildLostPostsResource(db, components),
  adoption_posts: buildAdoptionPostsResource(db, components),
  product_posts: buildProductPostsResource(db, components),
  mating_posts: buildMatingPostsResource(db, components),
};

const REFERENCES = {
  post_reports: ['post_id', 'reporter_id', 'reviewed_by_admin_id'],
  comment_reports: ['comment_id', 'reporter_id'],
  account_reports: ['reporter_id', 'reported_user_id', 'source_id', 'reviewed_by_admin_id'],
  comments: ['post_id', 'author_id', 'parent_id'],
  post_media: ['post_id'],
  post_saves: ['post_id', 'user_id'],
  post_upvotes: ['post_id', 'user_id'],
  notifications: ['recipient_id', 'related_post_id', 'related_contact_request_id', 'related_application_id'],
  moderation_actions: ['admin_user_id', 'target_id'],
  contact_requests: ['post_id', 'requester_id'],
  adoption_applications: ['target_post_id', 'applicant_id'],
  vet_clinic_location_audits: ['vet_clinic_id', 'admin_user_id'],
  posts: ['creator_id', 'moderated_by_admin_id'],
  users: ['banned_by_admin_id'],
  rescue_posts: ['post_id'],
  lost_posts: ['post_id'],
  adoption_posts: ['post_id'],
  product_posts: ['post_id'],
  mating_posts: ['post_id'],
};

describe('reference columns link to their record', () => {
  it("gives every foreign key the ReferenceLink and keeps ShortUuid for a record's own id only", () => {
    for (const [name, fields] of Object.entries(REFERENCES)) {
      const properties = resources[name].options.properties;
      for (const field of fields) {
        assert.equal(properties[field]?.components?.show, 'ReferenceLinkMock', `${name}.${field} on show`);
      }
      for (const [field, property] of Object.entries(properties)) {
        for (const where of ['list', 'show']) {
          if (property.components?.[where] === 'ShortUuidMock') {
            assert.equal(field, 'id', `${name}.${field} (${where}) must not be a copy-only UUID`);
          }
        }
      }
    }
  });

  it('shows references in lists too, except the ones that only appear on show pages', () => {
    const showOnly = new Set([
      'posts.creator_id',
      'posts.moderated_by_admin_id',
      'users.banned_by_admin_id',
      'notifications.related_post_id',
      'notifications.related_contact_request_id',
      'notifications.related_application_id',
    ]);
    for (const [name, fields] of Object.entries(REFERENCES)) {
      for (const field of fields) {
        const list = resources[name].options.properties[field].components.list;
        assert.equal(list, showOnly.has(`${name}.${field}`) ? undefined : 'ReferenceLinkMock', `${name}.${field}`);
      }
    }
  });

  it('labels every reference without the trailing "Id"', () => {
    const fields = new Set(Object.values(REFERENCES).flat());
    for (const field of fields) {
      assert.ok(PROPERTY_LABELS[field], `${field} needs a label`);
      assert.doesNotMatch(PROPERTY_LABELS[field], /\bId\b/);
    }
    assert.equal(PROPERTY_LABELS.reporter_id, 'Reported by');
    assert.equal(PROPERTY_LABELS.reported_user_id, 'Reported account');
    assert.equal(PROPERTY_LABELS.author_id, 'Author');
    assert.equal(PROPERTY_LABELS.reviewed_by_admin_id, 'Reviewed by');
    assert.equal(PROPERTY_LABELS.recipient_id, 'Recipient');
  });

  it('resolves polymorphic targets for Account Reports and Moderation Actions in list and show', () => {
    for (const name of ['account_reports', 'moderation_actions']) {
      for (const action of ['list', 'show']) {
        const hooks = [resources[name].options.actions[action].after].flat();
        assert.equal(hooks.length, 2, `${name}.${action} strips hashes and resolves the target`);
      }
    }
  });
});
