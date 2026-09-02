import { ValidationError } from 'adminjs';
import { ENUMS } from '../enums.js';
import { buildPostActions } from '../actions/moderate-post.actions.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';

export const PROTECTED_POST_FIELDS = [
  'id',
  'creator_id',
  'post_type',
  'status',
  'moderation_status',
  'moderation_reason',
  'moderated_at',
  'moderated_by_admin_id',
  'urgency',
  'market_category',
  'effective_score',
  'upvote_count',
  'save_count',
  'view_count',
  'report_count',
  'coordinates',
  'latitude',
  'longitude',
  'coordinates.latitude',
  'coordinates.longitude',
  'last_engaged_at',
  'created_at',
  'updated_at',
];

export function buildPostsResource(db, pool, components, cache) {
  const knex = db?.table ? (db.table('posts')?.knex ?? db.table('cities')?.knex) : null;

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

  async function preparePostEditPayload(request, context = {}) {
    if (request.method !== 'post') return request;
    const payload = { ...(request.payload || {}) };
    const recordId = request.params?.recordId;

    // Service-owned structure, authorship, derived classification, exact coordinates,
    // and moderation / ranking fields cannot be mutated via AdminJS edit requests.
    for (const field of PROTECTED_POST_FIELDS) {
      delete payload[field];
    }

    let existing = null;
    if (recordId) {
      if (pool && typeof pool.query === 'function') {
        const { rows } = await pool.query(`SELECT * FROM posts WHERE id = $1`, [recordId]);
        existing = rows[0] ?? null;
      } else if (knex) {
        const rows = await knex('posts').where('id', recordId);
        existing = rows[0] ?? null;
      }
    }

    if (payload.city_id !== undefined) {
      if (!payload.city_id) {
        throw new ValidationError({
          city_id: { message: 'Must select an existing official City' },
        });
      }
      const isChanged = !existing || payload.city_id !== existing.city_id;
      if (isChanged) {
        const city = await getCityById(payload.city_id);
        if (!city || city.status !== 'OFFICIAL') {
          throw new ValidationError({
            city_id: { message: 'Must select an existing official City' },
          });
        }
        payload.governorate = city.governorate;
      } else if (existing?.governorate) {
        payload.governorate = existing.governorate;
      } else {
        delete payload.governorate;
      }
    } else if (payload.governorate && existing?.governorate) {
      payload.governorate = existing.governorate;
    } else {
      delete payload.governorate;
    }

    request.payload = payload;
    return request;
  }

  const properties = {
    id: { isDisabled: true },
    creator_id: { isDisabled: true },
    title: { isTitle: true },
    description: {},
    post_type: enumProperty(ENUMS.postType, { isDisabled: true }),
    status: enumProperty(ENUMS.postStatus, { isDisabled: true }),
    moderation_status: enumProperty(ENUMS.moderationStatus, {
      isDisabled: true,
    }),
    urgency: enumProperty(ENUMS.urgencyTier, { isDisabled: true }),
    market_category: enumProperty(ENUMS.productCategory, { isDisabled: true }),
    effective_score: { isDisabled: true },
    upvote_count: { isDisabled: true },
    save_count: { isDisabled: true },
    view_count: { isDisabled: true },
    report_count: { isDisabled: true },
    moderation_reason: { isDisabled: true },
    moderated_at: { isDisabled: true },
    moderated_by_admin_id: { isDisabled: true },
    city_id: {},
    governorate: { isDisabled: true },
    area_name: {},
    coordinates: {
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    last_engaged_at: { isDisabled: true },
    created_at: { isDisabled: true },
    updated_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id'], components, ['list', 'show']);
  attachShortUuid(properties, ['creator_id', 'moderated_by_admin_id'], components, ['show']);

  return {
    resource: db.table('posts'),
    options: {
      navigation: { name: 'Moderation', icon: 'FileText' },
      properties,
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
        edit: {
          before: preparePostEditPayload,
          after: stripPopulatedPasswordHashes,
        },
        ...buildPostActions(pool, components?.ModerationAction, cache),
      },
      listProperties: ['id', 'title', 'post_type', 'status', 'moderation_status', 'report_count', 'created_at'],
      showProperties: [
        'id',
        'title',
        'description',
        'post_type',
        'status',
        'moderation_status',
        'urgency',
        'market_category',
        'creator_id',
        'city_id',
        'governorate',
        'area_name',
        'coordinates',
        'upvote_count',
        'save_count',
        'view_count',
        'report_count',
        'moderation_reason',
        'moderated_at',
        'moderated_by_admin_id',
        'effective_score',
        'last_engaged_at',
        'created_at',
        'updated_at',
      ],
      filterProperties: [
        'id',
        'creator_id',
        'post_type',
        'status',
        'moderation_status',
        'urgency',
        'city_id',
        'created_at',
      ],
      sort: { sortBy: 'created_at', direction: 'desc' },
    },
  };
}
