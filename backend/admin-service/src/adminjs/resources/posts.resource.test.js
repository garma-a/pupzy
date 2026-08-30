import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import { buildPostsResource } from './posts.resource.js';

const db = { table: (name) => ({ name }) };
const pool = {};
const components = { ModerationAction: 'ModerationAction' };

describe('AdminJS Posts Resource Configuration & City/Governorate Contracts', () => {
  const resource = buildPostsResource(db, pool, components);

  it('disables post creation (new action) and deletions (delete, bulkDelete)', () => {
    const actions = resource.options.actions;
    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it('marks governorate as disabled to prevent independent manual editing', () => {
    const props = resource.options.properties;
    assert.equal(props.governorate.isDisabled, true);
  });

  it('marks exact coordinates as view-only (hidden from list/edit, visible on show)', () => {
    const props = resource.options.properties;
    assert.deepEqual(props.coordinates.isVisible, {
      list: false,
      show: true,
      edit: false,
      filter: false,
    });
  });

  it('includes city_id in filterProperties', () => {
    assert.ok(resource.options.filterProperties.includes('city_id'));
  });

  it('declares concise intentional listProperties and full showProperties', () => {
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'title',
      'post_type',
      'status',
      'moderation_status',
      'report_count',
      'created_at',
    ]);
    assert.ok(resource.options.showProperties.includes('description'));
    assert.ok(resource.options.showProperties.includes('creator_id'));
    assert.ok(resource.options.showProperties.includes('coordinates'));
  });

  it('wires ShortUuid component to id, creator_id, and moderated_by_admin_id', () => {
    const customComponents = { ShortUuid: 'CustomShortUuid' };
    const res = buildPostsResource(db, pool, customComponents);
    assert.equal(res.options.properties.id.components.list, 'CustomShortUuid');
    assert.equal(res.options.properties.id.components.show, 'CustomShortUuid');
    assert.equal(res.options.properties.creator_id.components.show, 'CustomShortUuid');
    assert.equal(res.options.properties.moderated_by_admin_id.components.show, 'CustomShortUuid');
  });

  it('strips populated password hashes from list and show after hooks', () => {
    const listAfter = resource.options.actions.list.after;
    const response = {
      record: {
        params: { id: 'post-1' },
        populated: {
          creator_id: {
            params: { id: 'user-1', password_hash: 'secret' },
          },
        },
      },
    };
    const cleaned = listAfter(response);
    assert.equal(cleaned.record.populated.creator_id.params.password_hash, undefined);
  });

  it('edit before hook rejects non-official (LEGACY / RETIRED / non-existent) city_id', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM cities')) {
          if (params[0] === 'legacy-city-id') {
            return {
              rows: [
                {
                  id: 'legacy-city-id',
                  name_english: 'Old Village',
                  name_arabic: 'قرية قديمة',
                  governorate: 'Giza',
                  status: 'LEGACY',
                },
              ],
            };
          }
          return { rows: [] };
        }
        if (sql.includes('FROM posts')) {
          return {
            rows: [
              {
                id: 'post-1',
                city_id: 'official-old-city',
                governorate: 'Cairo',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildPostsResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    // 1. Non-existent city
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'post-1' },
          payload: { city_id: 'nonexistent-city-id' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.city_id.message, 'Must select an existing official City');
        return true;
      },
    );

    // 2. Legacy city
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'post-1' },
          payload: { city_id: 'legacy-city-id' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.city_id.message, 'Must select an existing official City');
        return true;
      },
    );
  });

  it('edit before hook accepts official city_id and automatically derives governorate', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM cities')) {
          if (params[0] === 'official-alex-id') {
            return {
              rows: [
                {
                  id: 'official-alex-id',
                  name_english: 'Montaza',
                  name_arabic: 'المنتزه',
                  governorate: 'Alexandria',
                  status: 'OFFICIAL',
                },
              ],
            };
          }
        }
        if (sql.includes('FROM posts')) {
          return {
            rows: [
              {
                id: 'post-1',
                city_id: 'official-cairo-id',
                governorate: 'Cairo',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildPostsResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    const request = {
      method: 'post',
      params: { recordId: 'post-1' },
      payload: {
        city_id: 'official-alex-id',
        governorate: 'Contradictory Cairo', // Attempted override
        coordinates: 'SRID=4326;POINT(0 0)', // Attempted coordinate edit
        latitude: 0,
        longitude: 0,
      },
    };

    const result = await editHook(request);
    assert.equal(result.payload.city_id, 'official-alex-id');
    assert.equal(result.payload.governorate, 'Alexandria'); // Synchronized with Montaza's governorate
    assert.equal(result.payload.coordinates, undefined);
    assert.equal(result.payload.latitude, undefined);
    assert.equal(result.payload.longitude, undefined);
  });

  it('marks structural, authorship, computed urgency, market category, moderation, ranking, timestamp, and coordinate fields as disabled in edit form', () => {
    const props = resource.options.properties;
    assert.equal(props.id.isDisabled, true);
    assert.equal(props.creator_id.isDisabled, true);
    assert.equal(props.post_type.isDisabled, true);
    assert.equal(props.status.isDisabled, true);
    assert.equal(props.moderation_status.isDisabled, true);
    assert.equal(props.moderation_reason.isDisabled, true);
    assert.equal(props.moderated_at.isDisabled, true);
    assert.equal(props.moderated_by_admin_id.isDisabled, true);
    assert.equal(props.urgency.isDisabled, true);
    assert.equal(props.market_category.isDisabled, true);
    assert.equal(props.effective_score.isDisabled, true);
    assert.equal(props.upvote_count.isDisabled, true);
    assert.equal(props.save_count.isDisabled, true);
    assert.equal(props.view_count.isDisabled, true);
    assert.equal(props.report_count.isDisabled, true);
    assert.equal(props.governorate.isDisabled, true);
    assert.equal(props.coordinates.isVisible.edit, false);
    assert.equal(props.last_engaged_at.isDisabled, true);
    assert.equal(props.created_at.isDisabled, true);
    assert.equal(props.updated_at.isDisabled, true);
  });

  it('edit before hook strips all protected structural, authorship, classification, coordinate, moderation, ranking, and timestamp fields from crafted payload', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM posts')) {
          return {
            rows: [
              {
                id: 'post-1',
                city_id: 'official-cairo-id',
                governorate: 'Cairo',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildPostsResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    const craftedPayload = {
      id: 'attacker-id',
      creator_id: 'attacker-creator-id',
      post_type: 'PRODUCT',
      status: 'REMOVED',
      moderation_status: 'CLEAN',
      moderation_reason: 'Tampered reason',
      moderated_at: '2026-01-01T00:00:00Z',
      moderated_by_admin_id: '00000000-0000-0000-0000-000000000000',
      urgency: 'CRITICAL',
      market_category: 'FOOD',
      effective_score: 9999.9,
      upvote_count: 999,
      save_count: 999,
      view_count: 9999,
      report_count: 0,
      coordinates: 'SRID=4326;POINT(0 0)',
      latitude: 0,
      longitude: 0,
      'coordinates.latitude': 0,
      'coordinates.longitude': 0,
      last_engaged_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      title: 'Legitimate Title Update',
      description: 'Legitimate Description Update',
      area_name: 'Maadi Degla',
    };

    const result = await editHook({
      method: 'post',
      params: { recordId: 'post-1' },
      payload: craftedPayload,
    });

    // Permitted fields remain
    assert.equal(result.payload.title, 'Legitimate Title Update');
    assert.equal(result.payload.description, 'Legitimate Description Update');
    assert.equal(result.payload.area_name, 'Maadi Degla');

    // Every protected field is stripped
    assert.equal(result.payload.id, undefined);
    assert.equal(result.payload.creator_id, undefined);
    assert.equal(result.payload.post_type, undefined);
    assert.equal(result.payload.status, undefined);
    assert.equal(result.payload.moderation_status, undefined);
    assert.equal(result.payload.moderation_reason, undefined);
    assert.equal(result.payload.moderated_at, undefined);
    assert.equal(result.payload.moderated_by_admin_id, undefined);
    assert.equal(result.payload.urgency, undefined);
    assert.equal(result.payload.market_category, undefined);
    assert.equal(result.payload.effective_score, undefined);
    assert.equal(result.payload.upvote_count, undefined);
    assert.equal(result.payload.save_count, undefined);
    assert.equal(result.payload.view_count, undefined);
    assert.equal(result.payload.report_count, undefined);
    assert.equal(result.payload.coordinates, undefined);
    assert.equal(result.payload.latitude, undefined);
    assert.equal(result.payload.longitude, undefined);
    assert.equal(result.payload['coordinates.latitude'], undefined);
    assert.equal(result.payload['coordinates.longitude'], undefined);
    assert.equal(result.payload.last_engaged_at, undefined);
    assert.equal(result.payload.created_at, undefined);
    assert.equal(result.payload.updated_at, undefined);
  });

  it('edit before hook rejects empty, null, or retired city_id', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM cities')) {
          if (params[0] === 'retired-city-id') {
            return {
              rows: [
                {
                  id: 'retired-city-id',
                  name_english: 'Old Suburb',
                  name_arabic: 'ضاحية قديمة',
                  governorate: 'Alexandria',
                  status: 'RETIRED',
                },
              ],
            };
          }
          return { rows: [] };
        }
        if (sql.includes('FROM posts')) {
          return {
            rows: [
              {
                id: 'post-1',
                city_id: 'official-cairo-id',
                governorate: 'Cairo',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildPostsResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    // 1. Empty string city_id
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'post-1' },
          payload: { city_id: '' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.city_id.message, 'Must select an existing official City');
        return true;
      },
    );

    // 2. Null city_id
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'post-1' },
          payload: { city_id: null },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.city_id.message, 'Must select an existing official City');
        return true;
      },
    );

    // 3. Retired city
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'post-1' },
          payload: { city_id: 'retired-city-id' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.city_id.message, 'Must select an existing official City');
        return true;
      },
    );
  });

  it('edit before hook preserves historical legacy city and governorate when updating non-city fields', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM posts')) {
          return {
            rows: [
              {
                id: 'post-legacy-1',
                city_id: 'legacy-city-id',
                governorate: 'Giza',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildPostsResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    // 1. Edit submitting unchanged legacy city_id
    const result1 = await editHook({
      method: 'post',
      params: { recordId: 'post-legacy-1' },
      payload: {
        title: 'Updated Title',
        city_id: 'legacy-city-id',
      },
    });
    assert.equal(result1.payload.title, 'Updated Title');
    assert.equal(result1.payload.city_id, 'legacy-city-id');
    assert.equal(result1.payload.governorate, 'Giza');

    // 2. Edit without city_id in payload
    const result2 = await editHook({
      method: 'post',
      params: { recordId: 'post-legacy-1' },
      payload: {
        title: 'Another Update',
      },
    });
    assert.equal(result2.payload.title, 'Another Update');
    assert.equal(result2.payload.city_id, undefined);
    assert.equal(result2.payload.governorate, undefined);
  });
});
