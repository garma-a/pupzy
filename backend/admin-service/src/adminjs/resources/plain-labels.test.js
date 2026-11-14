import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROPERTY_LABELS } from '../property-labels.js';
import { buildAdminUsersResource } from './admin-users.resource.js';
import { buildAnnouncementsResource } from './announcements.resource.js';
import { buildAdoptionApplicationsResource } from './adoption-applications.resource.js';
import { buildAdoptionPostsResource } from './adoption-posts.resource.js';
import { buildCitiesResource } from './cities.resource.js';
import { buildContactRequestsResource } from './contact-requests.resource.js';
import { buildLostPostsResource } from './lost-posts.resource.js';
import { buildMatingPostsResource } from './mating-posts.resource.js';
import { buildModerationActionsResource } from './moderation-actions.resource.js';
import { buildNotificationsResource } from './notifications.resource.js';
import { buildPostMediaResource } from './post-media.resource.js';
import { buildPostReportsResource } from './post-reports.resource.js';
import { buildCommentReportsResource } from './comment-reports.resource.js';
import { buildAccountReportsResource } from './account-reports.resource.js';
import { buildPostSavesResource } from './post-saves.resource.js';
import { buildPostUpvotesResource } from './post-upvotes.resource.js';
import { buildPostsResource } from './posts.resource.js';
import { buildProductPostsResource } from './product-posts.resource.js';
import { buildRescuePostsResource } from './rescue-posts.resource.js';
import { buildUsersResource } from './users.resource.js';
import { buildCommentsResource } from './comments.resource.js';
import { buildVetClinicsResource } from './vet-clinics.resource.js';
import { buildVetClinicLocationAuditsResource } from './vet-clinic-location-audits.resource.js';

const db = { table: (name) => ({ name }) };
const pool = {};
const components = new Proxy({}, { get: (_, name) => String(name) });

function resources() {
  return [
    buildUsersResource(db, pool, components),
    buildPostsResource(db, pool, components),
    buildRescuePostsResource(db, components),
    buildLostPostsResource(db, components),
    buildAdoptionPostsResource(db, components),
    buildProductPostsResource(db, components),
    buildMatingPostsResource(db, components),
    buildPostMediaResource(db, components),
    buildPostUpvotesResource(db, components),
    buildPostSavesResource(db, components),
    buildPostReportsResource(db, components),
    buildCommentReportsResource(db, components),
    buildAccountReportsResource(db, components),
    buildCommentsResource(db, pool, components),
    buildContactRequestsResource(db, components),
    buildAdoptionApplicationsResource(db, components),
    buildNotificationsResource(db, components),
    buildCitiesResource(db, components),
    buildVetClinicsResource(db, pool, components),
    buildAdminUsersResource(db, components),
    buildModerationActionsResource(db, components),
    buildVetClinicLocationAuditsResource(db, components),
    buildAnnouncementsResource(db, pool, components),
  ];
}

describe('Plain-language coverage', () => {
  it('labels every list, show and filter property and every displayed enum value', () => {
    for (const resource of resources()) {
      const options = resource.options;
      for (const view of ['listProperties', 'showProperties', 'filterProperties']) {
        for (const name of options[view] ?? []) {
          const label = PROPERTY_LABELS[name];
          assert.ok(label, `${resource.resource.name}.${name} (${view}) needs a label`);
          assert.doesNotMatch(label, /_|\bId$/);
        }
      }
      for (const [name, property] of Object.entries(options.properties ?? {})) {
        for (const entry of property.availableValues ?? []) {
          assert.ok(entry.label, `${resource.resource.name}.${name}.${entry.value} needs a label`);
          assert.doesNotMatch(entry.label, /_|^[A-Z]{2,}$/);
        }
      }
    }
  });
});
