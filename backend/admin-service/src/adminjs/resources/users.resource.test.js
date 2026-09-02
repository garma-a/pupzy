import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import { ALLOWED_USER_EDIT_FIELDS, PROTECTED_USER_FIELDS, buildUsersResource } from './users.resource.js';

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

  it('declares concise intentional listProperties, showProperties, and editProperties', () => {
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

    // editProperties must match ALLOWED_USER_EDIT_FIELDS
    assert.deepEqual(resource.options.editProperties, [
      'full_name',
      'full_name_arabic',
      'profile_picture_url',
      'home_city_id',
      'language_preference',
      'notifications_enabled',
    ]);
  });

  it('wires ShortUuid component to id and banned_by_admin_id', () => {
    const customComponents = { ShortUuid: 'CustomShortUuid' };
    const res = buildUsersResource(db, pool, customComponents);
    assert.equal(res.options.properties.id.components.list, 'CustomShortUuid');
    assert.equal(res.options.properties.id.components.show, 'CustomShortUuid');
    assert.equal(res.options.properties.banned_by_admin_id.components.show, 'CustomShortUuid');
  });

  it('marks service-owned, auth, trust, counter, and ban audit properties as isDisabled', () => {
    const props = resource.options.properties;
    assert.equal(props.id.isDisabled, true);
    assert.equal(props.firebase_user_id.isDisabled, true);
    assert.equal(props.email.isDisabled, true);
    assert.equal(props.is_verified.isDisabled, true);
    assert.equal(props.post_count.isDisabled, true);
    assert.equal(props.rescue_post_count.isDisabled, true);
    assert.equal(props.lost_post_count.isDisabled, true);
    assert.equal(props.adoption_post_count.isDisabled, true);
    assert.equal(props.product_post_count.isDisabled, true);
    assert.equal(props.is_banned.isDisabled, true);
    assert.equal(props.banned_at.isDisabled, true);
    assert.equal(props.ban_reason.isDisabled, true);
    assert.equal(props.banned_by_admin_id.isDisabled, true);
    assert.equal(props.last_seen_at.isDisabled, true);
    assert.equal(props.created_at.isDisabled, true);
    assert.equal(props.updated_at.isDisabled, true);
  });

  it('exposes state-aware banUser and unbanUser actions', () => {
    const actions = resource.options.actions;
    assert.ok(actions.banUser, 'banUser action must be configured');
    assert.ok(actions.unbanUser, 'unbanUser action must be configured');
    assert.equal(actions.banUser.actionType, 'record');
    assert.equal(actions.unbanUser.actionType, 'record');
  });

  it('edit before hook strips all protected authentication, trust, counters, and private fields from tampered edit payloads', async () => {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'user-tamper-1',
                firebase_user_id: 'original-firebase-uid',
                email: 'original@example.com',
                full_name: 'Original Name',
                is_verified: false,
                is_banned: false,
                post_count: 5,
                home_city_id: 'official-city-id',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const res = buildUsersResource(db, mockPool, components);
    const editHook = res.options.actions.edit.before;

    const tamperedPayload = {
      // Intentionally editable profile fields
      full_name: 'Sanctioned Name',
      full_name_arabic: 'الاسم المعتمد',
      profile_picture_url: 'https://example.com/avatar.jpg',
      language_preference: 'en',
      notifications_enabled: false,

      // Malicious/tampered auth & identity fields
      id: 'hacked-uuid',
      firebase_user_id: 'hacked-firebase-uid',
      firebase_uid: 'hacked-firebase-uid',
      email: 'hacked@example.com',

      // Trust and verification fields
      is_verified: true,
      is_phone_verified: true,
      is_email_verified: true,

      // Ban and audit fields
      is_banned: true,
      ban_reason: 'Tampered reason',
      banned_at: new Date().toISOString(),
      banned_by_admin_id: 'admin-tamper-id',

      // Post counters
      post_count: 999,
      rescue_post_count: 100,
      lost_post_count: 50,
      adoption_post_count: 200,
      product_post_count: 300,
      rescue_count: 100,
      lost_count: 50,
      adoption_count: 200,
      product_count: 300,
      mating_count: 400,

      // Timestamps & state
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),

      // Private phone and location data
      phone_number: '+201099999999',
      last_known_location: 'POINT(30 31)',
      location: 'Cairo',
      latitude: 30.0,
      longitude: 31.0,
      coordinates: { latitude: 30.0, longitude: 31.0 },
      'coordinates.latitude': 30.0,
      'coordinates.longitude': 31.0,
      password_hash: 'hacked_hash',
    };

    const req = {
      method: 'post',
      params: { recordId: 'user-tamper-1' },
      payload: tamperedPayload,
    };

    const result = await editHook(req);

    // Only approved editable profile fields remain
    assert.deepEqual(result.payload, {
      full_name: 'Sanctioned Name',
      full_name_arabic: 'الاسم المعتمد',
      profile_picture_url: 'https://example.com/avatar.jpg',
      language_preference: 'en',
      notifications_enabled: false,
    });

    // Verify all protected fields were removed
    for (const protectedField of PROTECTED_USER_FIELDS) {
      assert.equal(
        result.payload[protectedField],
        undefined,
        `Field "${protectedField}" must be stripped from edit payload`,
      );
    }
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
