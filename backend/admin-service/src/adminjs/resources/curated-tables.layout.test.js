import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { ADMIN_RESOURCE_TABLES } from '../index.js';
import { buildRescuePostsResource } from './rescue-posts.resource.js';
import { buildLostPostsResource } from './lost-posts.resource.js';
import { buildAdoptionPostsResource } from './adoption-posts.resource.js';
import { buildProductPostsResource } from './product-posts.resource.js';
import { buildMatingPostsResource } from './mating-posts.resource.js';
import { buildPostMediaResource } from './post-media.resource.js';
import { buildPostUpvotesResource } from './post-upvotes.resource.js';
import { buildPostSavesResource } from './post-saves.resource.js';
import { buildCitiesResource } from './cities.resource.js';
import { buildVetClinicsResource } from './vet-clinics.resource.js';
import { buildAdminUsersResource } from './admin-users.resource.js';
import { buildModerationActionsResource } from './moderation-actions.resource.js';
import { buildVetClinicLocationAuditsResource } from './vet-clinic-location-audits.resource.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const themeCssPath = path.join(currentDir, '..', 'public', 'pupzy-theme.css');
const db = { table: (name) => ({ name }) };
const pool = {};
const components = {
  ShortUuid: 'ShortUuidMock',
  ModerationAction: 'ModerationActionMock',
  MappedLocationEdit: 'MappedLocationEditMock',
  MappedLocationShow: 'MappedLocationShowMock',
};

describe('Curated Detail, Engagement, Reference, and Administration Tables (Task 11)', () => {
  const cssContent = fs.readFileSync(themeCssPath, 'utf-8');

  describe('Pupzy Theme CSS & Table Presentation Rules', () => {
    it('configures table wrappers for horizontal overflow scrolling and min-width', () => {
      assert.match(cssContent, /overflow-x:\s*auto\s*!important/);
      assert.match(cssContent, /min-width:\s*600px/);
    });

    it('enforces no-wrap on IDs, timestamps, enums, counts, and action cells', () => {
      assert.match(cssContent, /td\[data-property-name\*=['"]id['"]\]/);
      assert.match(cssContent, /td\[data-property-name\*=['"]_at['"]\]/);
      assert.match(cssContent, /td\[data-property-name\*=['"]status['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]species['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]gender['"]\]/);
      assert.match(cssContent, /td\.adminjs_TableActionCell/);
    });

    it('configures text truncation for list titles, detail summaries, circumstances, and addresses', () => {
      assert.match(cssContent, /td\[data-property-name=['"]condition_summary['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]circumstances['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]color_and_markings['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]pet_name['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]breed['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]address_english['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]address_arabic['"]\]/);
      assert.match(cssContent, /td\[data-property-name=['"]public_url['"]\]/);
    });
  });

  describe('Detail Resources Curation', () => {
    it('rescue_posts exposes scan-oriented columns and ShortUuid without new/delete actions', () => {
      const res = buildRescuePostsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'post_id',
        'species',
        'reporter_role',
        'is_life_threatening',
        'condition_summary',
      ]);
      assert.ok(res.options.showProperties.includes('has_visible_serious_injury'));
      assert.ok(res.options.showProperties.includes('can_animal_move_or_escape'));
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.post_id.components.show, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
      assert.equal(res.options.actions.bulkDelete.isAccessible, false);
    });

    it('lost_posts exposes scan-oriented columns and ShortUuid', () => {
      const res = buildLostPostsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'post_id',
        'report_type',
        'species',
        'pet_name',
        'breed',
        'current_condition',
        'is_currently_safe_with_reporter',
      ]);
      assert.ok(res.options.showProperties.includes('circumstances'));
      assert.ok(res.options.showProperties.includes('color_and_markings'));
      assert.ok(res.options.showProperties.includes('has_collar_with_identification_tag'));
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('adoption_posts exposes scan-oriented columns and ShortUuid', () => {
      const res = buildAdoptionPostsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'post_id',
        'pet_name',
        'species',
        'gender',
        'breed',
        'vaccinated',
        'neutered',
        'space_requirement',
      ]);
      assert.ok(res.options.showProperties.includes('personality_tags'));
      assert.ok(res.options.showProperties.includes('health_notes'));
      assert.ok(res.options.showProperties.includes('additional_requirements'));
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('product_posts exposes scan-oriented columns and ShortUuid', () => {
      const res = buildProductPostsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'post_id',
        'category',
        'condition',
        'is_free',
        'price_amount',
        'price_currency',
        'open_to_offers',
      ]);
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('mating_posts exposes scan-oriented columns and ShortUuid', () => {
      const res = buildMatingPostsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'post_id',
        'pet_name',
        'species',
        'gender',
        'breed',
        'is_purebred',
        'has_pedigree_certificate',
      ]);
      assert.ok(res.options.showProperties.includes('terms_summary'));
      assert.ok(res.options.showProperties.includes('mating_conditions'));
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });
  });

  describe('Media & Engagement Resources Curation', () => {
    it('post_media exposes compact columns and ShortUuid on id and post_id', () => {
      const res = buildPostMediaResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'id',
        'post_id',
        'display_order',
        'file_content_type',
        'file_size_bytes',
        'created_at',
      ]);
      assert.ok(res.options.showProperties.includes('public_url'));
      assert.ok(res.options.showProperties.includes('cloudflare_storage_key'));
      assert.equal(res.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('post_upvotes is completely read-only and uses ShortUuid', () => {
      const res = buildPostUpvotesResource(db, components);
      assert.deepEqual(res.options.listProperties, ['post_id', 'user_id', 'created_at']);
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.user_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.edit.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('post_saves is completely read-only and uses ShortUuid', () => {
      const res = buildPostSavesResource(db, components);
      assert.deepEqual(res.options.listProperties, ['post_id', 'user_id', 'created_at']);
      assert.equal(res.options.properties.post_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.user_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.edit.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });
  });

  describe('Reference Resources Curation', () => {
    it('cities is read-only, bilingual, lifecycle-aware, and attaches ShortUuid on show', () => {
      const res = buildCitiesResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'name_english',
        'name_arabic',
        'governorate',
        'source_code',
        'status',
      ]);
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.edit.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
      assert.equal(res.options.properties.id.components.show, 'ShortUuidMock');
    });

    it('vet_clinics exposes bilingual addresses and omits coordinates from list', () => {
      const res = buildVetClinicsResource(db, pool, components);
      assert.deepEqual(res.options.listProperties, [
        'name_english',
        'name_arabic',
        'city_id',
        'phone_number',
        'address_english',
        'address_arabic',
        'source',
        'is_active',
      ]);
      assert.ok(!res.options.listProperties.includes('coordinates'));
      assert.equal(res.options.properties.coordinates.isVisible.list, false);
      assert.equal(res.options.properties.coordinates.isVisible.show, true);
      assert.equal(res.options.properties.id.components.show, 'ShortUuidMock');
      assert.equal(res.options.actions.delete.isAccessible, false);
    });
  });

  describe('Admin & Audit Resources Curation', () => {
    it('admin_users protects password hashes and exposes operational fields with ShortUuid', () => {
      const res = buildAdminUsersResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'id',
        'email',
        'full_name',
        'role',
        'is_active',
        'last_login_at',
        'created_at',
      ]);
      assert.ok(!res.options.listProperties.includes('password_hash'));
      assert.ok(!res.options.showProperties.includes('password_hash'));
      assert.ok(!res.options.filterProperties.includes('password_hash'));
      assert.equal(res.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('moderation_actions is read-only, protects history, and uses ShortUuid for polymorphic IDs', () => {
      const res = buildModerationActionsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'id',
        'action_type',
        'target_type',
        'target_id',
        'admin_user_id',
        'reason',
        'created_at',
      ]);
      assert.equal(res.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.admin_user_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.target_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.edit.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });

    it('vet_clinic_location_audits is read-only, hides coordinates from list, and uses ShortUuid', () => {
      const res = buildVetClinicLocationAuditsResource(db, components);
      assert.deepEqual(res.options.listProperties, [
        'id',
        'vet_clinic_id',
        'admin_user_id',
        'selected_city_id',
        'nearest_city_id',
        'reason',
        'created_at',
      ]);
      assert.ok(!res.options.listProperties.includes('coordinates'));
      assert.ok(res.options.showProperties.includes('coordinates'));
      assert.ok(res.options.showProperties.includes('discrepancy_details'));
      assert.equal(res.options.properties.id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.vet_clinic_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.properties.admin_user_id.components.list, 'ShortUuidMock');
      assert.equal(res.options.actions.new.isAccessible, false);
      assert.equal(res.options.actions.edit.isAccessible, false);
      assert.equal(res.options.actions.delete.isAccessible, false);
    });
  });

  describe('Global Table Quality Across ALL 20 Registered Resources', () => {
    it('every registered resource in ADMIN_RESOURCE_TABLES defines explicit listProperties and no unsafe defaults', () => {
      const resourcesByTable = {
        rescue_posts: buildRescuePostsResource(db, components),
        lost_posts: buildLostPostsResource(db, components),
        adoption_posts: buildAdoptionPostsResource(db, components),
        product_posts: buildProductPostsResource(db, components),
        mating_posts: buildMatingPostsResource(db, components),
        post_media: buildPostMediaResource(db, components),
        post_upvotes: buildPostUpvotesResource(db, components),
        post_saves: buildPostSavesResource(db, components),
        cities: buildCitiesResource(db, components),
        vet_clinics: buildVetClinicsResource(db, pool, components),
        admin_users: buildAdminUsersResource(db, components),
        moderation_actions: buildModerationActionsResource(db, components),
        vet_clinic_location_audits: buildVetClinicLocationAuditsResource(db, components),
      };

      for (const table of Object.keys(resourcesByTable)) {
        const res = resourcesByTable[table];
        assert.ok(Array.isArray(res.options.listProperties), `${table} must have explicit listProperties array`);
        assert.ok(
          res.options.listProperties.length >= 3 && res.options.listProperties.length <= 8,
          `${table} listProperties length must be between 3 and 8 (was ${res.options.listProperties.length})`,
        );
        assert.ok(Array.isArray(res.options.showProperties), `${table} must have explicit showProperties array`);
        assert.ok(Array.isArray(res.options.filterProperties), `${table} must have explicit filterProperties array`);
        assert.equal(res.options.actions.delete?.isAccessible, false, `${table} must disable hard delete`);
        assert.equal(res.options.actions.bulkDelete?.isAccessible, false, `${table} must disable bulk delete`);
      }
    });
  });
});
