import { ValidationError } from 'adminjs';
import { buildBanUserAction, buildUnbanUserAction } from '../actions/ban-user.action.js';
import { attachShortUuid, noDeleteActions, stripRecordParams } from './resource-helpers.js';

const stripPrivateFields = (response) =>
  stripRecordParams(response, ['phone_number', 'last_known_location', 'password_hash']);

export function buildUsersResource(db, pool, components, cache) {
  const knex = db?.table ? (db.table('users')?.knex ?? db.table('cities')?.knex) : null;

  async function getCityById(cityId) {
    if (!cityId) return null;
    if (pool && typeof pool.query === 'function') {
      const { rows } = await pool.query(
        `SELECT id, name_english, name_arabic, governorate, status FROM cities WHERE id = $1`,
        [cityId],
      );
      return rows[0] ?? null;
    }
    if (knex) {
      const rows = await knex('cities')
        .select('id', 'name_english', 'name_arabic', 'governorate', 'status')
        .where('id', cityId);
      return rows[0] ?? null;
    }
    return null;
  }

  async function prepareUserEditPayload(request, context = {}) {
    if (request.method !== 'post') return request;
    const payload = { ...(request.payload || {}) };
    const recordId = request.params?.recordId;

    // Private fields cannot be edited via AdminJS
    delete payload.phone_number;
    delete payload.last_known_location;
    delete payload.password_hash;

    let existing = null;
    if (recordId) {
      if (pool && typeof pool.query === 'function') {
        const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [recordId]);
        existing = rows[0] ?? null;
      } else if (knex) {
        const rows = await knex('users').where('id', recordId);
        existing = rows[0] ?? null;
      }
    }

    if (payload.home_city_id === '' || payload.home_city_id === null) {
      payload.home_city_id = null;
    } else if (payload.home_city_id) {
      const isChanged = !existing || payload.home_city_id !== existing.home_city_id;
      if (isChanged) {
        const city = await getCityById(payload.home_city_id);
        if (!city || city.status !== 'OFFICIAL') {
          throw new ValidationError({
            home_city_id: { message: 'Must select an existing official City' },
          });
        }
      }
    }

    request.payload = payload;
    return request;
  }

  const properties = {
    email: { isTitle: true },
    home_city_id: {},
    phone_number: { isVisible: false },
    last_known_location: { isVisible: false },
    post_count: { isDisabled: true },
    rescue_post_count: { isDisabled: true },
    lost_post_count: { isDisabled: true },
    adoption_post_count: { isDisabled: true },
    product_post_count: { isDisabled: true },
    is_banned: { isDisabled: true },
    banned_at: { isDisabled: true },
    ban_reason: { isDisabled: true },
    banned_by_admin_id: { isDisabled: true },
    last_seen_at: { isDisabled: true },
    created_at: { isDisabled: true },
    updated_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id'], components, ['list', 'show']);
  attachShortUuid(properties, ['banned_by_admin_id'], components, ['show']);

  return {
    resource: db.table('users'),
    options: {
      navigation: { name: 'Moderation', icon: 'User' },
      properties,
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPrivateFields },
        search: { after: stripPrivateFields },
        show: { after: stripPrivateFields },
        edit: {
          before: prepareUserEditPayload,
          after: stripPrivateFields,
        },
        banUser: buildBanUserAction(pool, components?.ModerationAction, cache),
        unbanUser: buildUnbanUserAction(pool, cache),
      },
      listProperties: ['id', 'email', 'full_name', 'is_verified', 'is_banned', 'post_count', 'created_at'],
      showProperties: [
        'id',
        'firebase_user_id',
        'email',
        'full_name',
        'full_name_arabic',
        'profile_picture_url',
        'is_verified',
        'home_city_id',
        'post_count',
        'rescue_post_count',
        'lost_post_count',
        'adoption_post_count',
        'product_post_count',
        'language_preference',
        'notifications_enabled',
        'is_banned',
        'banned_at',
        'ban_reason',
        'banned_by_admin_id',
        'last_seen_at',
        'created_at',
        'updated_at',
      ],
      filterProperties: ['id', 'email', 'full_name', 'is_banned', 'is_verified', 'home_city_id', 'created_at'],
      sort: { sortBy: 'created_at', direction: 'desc' },
    },
  };
}
