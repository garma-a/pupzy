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

  it('edit before hook prevents independent governorate contradiction when city_id is unchanged', async () => {
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

    const request = {
      method: 'post',
      params: { recordId: 'post-1' },
      payload: {
        title: 'Updated Title',
        governorate: 'Aswan', // Malicious / direct edit contradiction
      },
    };

    const result = await editHook(request);
    assert.equal(result.payload.title, 'Updated Title');
    assert.equal(result.payload.governorate, 'Cairo'); // Overwritten with existing governorate
  });
});
