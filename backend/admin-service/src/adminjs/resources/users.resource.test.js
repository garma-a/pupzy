import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import { buildUsersResource } from './users.resource.js';

const db = { table: (name) => ({ name }) };
const pool = {};
const components = { ModerationAction: 'ModerationAction' };

describe('AdminJS Users Resource Configuration & City/Privacy Contracts', () => {
  const resource = buildUsersResource(db, pool, components);

  it('disables user creation (new action) and deletions (delete, bulkDelete)', () => {
    const actions = resource.options.actions;
    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it('hides private fields (phone_number, last_known_location) from UI', () => {
    const props = resource.options.properties;
    assert.equal(props.phone_number.isVisible, false);
    assert.equal(props.last_known_location.isVisible, false);
  });

  it('includes home_city_id in filterProperties', () => {
    assert.ok(resource.options.filterProperties.includes('home_city_id'));
  });

  it('declares concise intentional listProperties and full showProperties', () => {
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'email',
      'full_name',
      'is_verified',
      'is_banned',
      'post_count',
      'created_at',
    ]);
    assert.ok(resource.options.showProperties.includes('firebase_user_id'));
    assert.ok(resource.options.showProperties.includes('full_name_arabic'));
    assert.ok(resource.options.showProperties.includes('rescue_post_count'));
  });

  it('wires ShortUuid component to id and banned_by_admin_id', () => {
    const customComponents = { ShortUuid: 'CustomShortUuid' };
    const res = buildUsersResource(db, pool, customComponents);
    assert.equal(res.options.properties.id.components.list, 'CustomShortUuid');
    assert.equal(res.options.properties.id.components.show, 'CustomShortUuid');
    assert.equal(res.options.properties.banned_by_admin_id.components.show, 'CustomShortUuid');
  });

  it('edit before hook rejects non-official (LEGACY / RETIRED / non-existent) home_city_id', async () => {
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
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'user-1',
                home_city_id: 'official-old-city',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildUsersResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    // 1. Non-existent city
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'user-1' },
          payload: { home_city_id: 'nonexistent-city-id' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.home_city_id.message, 'Must select an existing official City');
        return true;
      },
    );

    // 2. Legacy city
    await assert.rejects(
      async () => {
        await editHook({
          method: 'post',
          params: { recordId: 'user-1' },
          payload: { home_city_id: 'legacy-city-id' },
        });
      },
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.propertyErrors.home_city_id.message, 'Must select an existing official City');
        return true;
      },
    );
  });

  it('edit before hook accepts official home_city_id and allows clearing home_city_id to null', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM cities')) {
          if (params[0] === 'official-city-id') {
            return {
              rows: [
                {
                  id: 'official-city-id',
                  name_english: 'Maadi',
                  name_arabic: 'المعادي',
                  governorate: 'Cairo',
                  status: 'OFFICIAL',
                },
              ],
            };
          }
        }
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'user-1',
                home_city_id: 'old-city-id',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildUsersResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    // 1. Official city selection succeeds
    const req1 = {
      method: 'post',
      params: { recordId: 'user-1' },
      payload: {
        full_name: 'Updated Name',
        home_city_id: 'official-city-id',
        phone_number: '+201012345678', // Attempted private edit
        last_known_location: 'POINT(0 0)',
        password_hash: 'hash',
      },
    };
    const result1 = await editHook(req1);
    assert.equal(result1.payload.home_city_id, 'official-city-id');
    assert.equal(result1.payload.full_name, 'Updated Name');
    assert.equal(result1.payload.phone_number, undefined);
    assert.equal(result1.payload.last_known_location, undefined);
    assert.equal(result1.payload.password_hash, undefined);

    // 2. Clear home_city_id (empty string -> null)
    const req2 = {
      method: 'post',
      params: { recordId: 'user-1' },
      payload: {
        home_city_id: '',
      },
    };
    const result2 = await editHook(req2);
    assert.equal(result2.payload.home_city_id, null);
  });
});
