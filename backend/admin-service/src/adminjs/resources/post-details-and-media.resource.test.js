import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENUMS } from '../enums.js';
import { buildRescuePostsResource } from './rescue-posts.resource.js';
import { buildLostPostsResource } from './lost-posts.resource.js';
import { buildAdoptionPostsResource } from './adoption-posts.resource.js';
import { buildProductPostsResource } from './product-posts.resource.js';
import { buildMatingPostsResource } from './mating-posts.resource.js';
import { buildPostMediaResource } from './post-media.resource.js';

const db = { table: (name) => ({ name }) };
const components = {
  ShortUuid: 'ShortUuidMock',
};

describe('Post Details & Media Safely Read-Only Resources', () => {
  const resources = {
    rescue_posts: buildRescuePostsResource(db, components),
    lost_posts: buildLostPostsResource(db, components),
    adoption_posts: buildAdoptionPostsResource(db, components),
    product_posts: buildProductPostsResource(db, components),
    mating_posts: buildMatingPostsResource(db, components),
    post_media: buildPostMediaResource(db, components),
  };

  it('disables all mutating actions (new, edit, delete, bulkDelete) across all 5 detail tables and post_media', () => {
    for (const [name, res] of Object.entries(resources)) {
      const actions = res.options.actions;
      assert.equal(actions.new?.isAccessible, false, `${name}.new must be disabled`);
      assert.equal(actions.edit?.isAccessible, false, `${name}.edit must be disabled`);
      assert.equal(actions.delete?.isAccessible, false, `${name}.delete must be disabled`);
      assert.equal(actions.bulkDelete?.isAccessible, false, `${name}.bulkDelete must be disabled`);
    }
  });

  it('preserves list and show actions with stripPopulatedPasswordHashes after hooks', () => {
    for (const [name, res] of Object.entries(resources)) {
      const actions = res.options.actions;
      assert.equal(typeof actions.list?.after, 'function', `${name}.list must have an after hook`);
      assert.equal(typeof actions.show?.after, 'function', `${name}.show must have an after hook`);

      const testPayload = {
        record: {
          params: { id: 'rec-1' },
          populated: {
            post_id: {
              params: { id: 'post-1', password_hash: 'leaked-hash' },
            },
          },
        },
      };
      const cleaned = actions.show.after(testPayload);
      assert.equal(cleaned.record.populated.post_id.params.password_hash, undefined);
    }
  });

  it('wires ShortUuid component to IDs on list and show views', () => {
    assert.equal(resources.rescue_posts.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.rescue_posts.options.properties.post_id.components.show, 'ShortUuidMock');

    assert.equal(resources.lost_posts.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.lost_posts.options.properties.post_id.components.show, 'ShortUuidMock');

    assert.equal(resources.adoption_posts.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.adoption_posts.options.properties.post_id.components.show, 'ShortUuidMock');

    assert.equal(resources.product_posts.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.product_posts.options.properties.post_id.components.show, 'ShortUuidMock');

    assert.equal(resources.mating_posts.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.mating_posts.options.properties.post_id.components.show, 'ShortUuidMock');

    assert.equal(resources.post_media.options.properties.id.components.list, 'ShortUuidMock');
    assert.equal(resources.post_media.options.properties.id.components.show, 'ShortUuidMock');
    assert.equal(resources.post_media.options.properties.post_id.components.list, 'ShortUuidMock');
    assert.equal(resources.post_media.options.properties.post_id.components.show, 'ShortUuidMock');
  });

  it('preserves complete detail fields in showProperties and scan-oriented listProperties', () => {
    // rescue_posts
    assert.deepEqual(resources.rescue_posts.options.listProperties, [
      'post_id',
      'species',
      'reporter_role',
      'is_life_threatening',
      'condition_summary',
    ]);
    assert.deepEqual(resources.rescue_posts.options.showProperties, [
      'post_id',
      'species',
      'reporter_role',
      'condition_summary',
      'is_life_threatening',
      'has_visible_serious_injury',
      'is_in_dangerous_location',
      'can_animal_move_or_escape',
    ]);

    // lost_posts
    assert.deepEqual(resources.lost_posts.options.listProperties, [
      'post_id',
      'report_type',
      'species',
      'pet_name',
      'breed',
      'current_condition',
      'is_currently_safe_with_reporter',
    ]);
    assert.ok(resources.lost_posts.options.showProperties.includes('circumstances'));
    assert.ok(resources.lost_posts.options.showProperties.includes('color_and_markings'));
    assert.ok(resources.lost_posts.options.showProperties.includes('has_collar_with_identification_tag'));
    assert.ok(resources.lost_posts.options.showProperties.includes('date_last_seen'));
    assert.ok(resources.lost_posts.options.showProperties.includes('date_found'));
    assert.ok(resources.lost_posts.options.showProperties.includes('has_medical_needs'));
    assert.ok(resources.lost_posts.options.showProperties.includes('is_elderly_or_very_young'));
    assert.ok(resources.lost_posts.options.showProperties.includes('last_seen_near_hazard'));

    // adoption_posts
    assert.deepEqual(resources.adoption_posts.options.listProperties, [
      'post_id',
      'pet_name',
      'species',
      'gender',
      'breed',
      'vaccinated',
      'neutered',
      'space_requirement',
    ]);
    assert.ok(resources.adoption_posts.options.showProperties.includes('personality_tags'));
    assert.ok(resources.adoption_posts.options.showProperties.includes('health_notes'));
    assert.ok(resources.adoption_posts.options.showProperties.includes('additional_requirements'));
    assert.ok(resources.adoption_posts.options.showProperties.includes('currently_with'));

    // product_posts
    assert.deepEqual(resources.product_posts.options.listProperties, [
      'post_id',
      'category',
      'condition',
      'is_free',
      'price_amount',
      'price_currency',
      'open_to_offers',
    ]);
    assert.deepEqual(resources.product_posts.options.showProperties, [
      'post_id',
      'category',
      'condition',
      'is_free',
      'price_amount',
      'price_currency',
      'open_to_offers',
    ]);

    // mating_posts
    assert.deepEqual(resources.mating_posts.options.listProperties, [
      'post_id',
      'pet_name',
      'species',
      'gender',
      'breed',
      'is_purebred',
      'has_pedigree_certificate',
    ]);
    assert.ok(resources.mating_posts.options.showProperties.includes('terms_summary'));
    assert.ok(resources.mating_posts.options.showProperties.includes('mating_conditions'));

    // post_media
    assert.deepEqual(resources.post_media.options.listProperties, [
      'id',
      'post_id',
      'display_order',
      'file_content_type',
      'file_size_bytes',
      'created_at',
    ]);
    assert.deepEqual(resources.post_media.options.showProperties, [
      'id',
      'post_id',
      'public_url',
      'cloudflare_storage_key',
      'display_order',
      'file_content_type',
      'file_size_bytes',
      'width',
      'height',
      'created_at',
    ]);
    assert.deepEqual(resources.post_media.options.sort, { sortBy: 'created_at', direction: 'desc' });
  });

  it('correctly maps enum availableValues for domain properties', () => {
    const rescueSpecies = resources.rescue_posts.options.properties.species.availableValues.map((v) => v.value);
    assert.deepEqual(rescueSpecies, ENUMS.speciesType);

    const rescueRole = resources.rescue_posts.options.properties.reporter_role.availableValues.map((v) => v.value);
    assert.deepEqual(rescueRole, ENUMS.reporterRole);

    const lostReportType = resources.lost_posts.options.properties.report_type.availableValues.map((v) => v.value);
    assert.deepEqual(lostReportType, ENUMS.lostFoundType);

    const lostCondition = resources.lost_posts.options.properties.current_condition.availableValues.map((v) => v.value);
    assert.deepEqual(lostCondition, ENUMS.foundAnimalCondition);

    const productCategory = resources.product_posts.options.properties.category.availableValues.map((v) => v.value);
    assert.deepEqual(productCategory, ENUMS.productCategory);

    const productCondition = resources.product_posts.options.properties.condition.availableValues.map((v) => v.value);
    assert.deepEqual(productCondition, ENUMS.productCondition);
  });
});
