import {
  buildAudienceCountQuery,
  validateAnnouncementDraft,
} from '../../../../src/notifications/admin-announcement.contract.ts';
import { isSuperAdmin } from '../rbac.js';
import { runModerationTransaction } from './helpers.js';

/**
 * An administrator's Announcement.
 *
 * The admin service only ever writes the announcement record and its audit row.
 * It never inserts a notification: the Nest backend's AdminAnnouncementProcessor
 * fans the Announcement out in durable background batches, so a send takes the
 * same time for ten users or a million.
 */

const NOT_SUPER_ADMIN = 'Only a super admin can send announcements.';

/** Thrown inside the send transaction to roll it back with a result for the caller. */
class SendRefused extends Error {
  constructor(result) {
    super(result.error ?? 'Announcement refused');
    this.result = result;
  }
}

async function findCity(db, cityId) {
  const { rows } = await db.query('SELECT id, name_english FROM cities WHERE id = $1', [cityId]);
  return rows[0] ?? null;
}

async function countAudience(db, { cutoff, audience, cityId }) {
  const query = buildAudienceCountQuery({ cutoff, audience, cityId });
  const { rows } = await db.query(query.text, query.values);
  return Number(rows[0].count);
}

function cityErrors() {
  return { cityId: 'This City no longer exists. Choose another.' };
}

/**
 * Validates a draft and returns the exact number of users who would receive it.
 * Read-only; this is what the compose page calls for the preview and for the
 * confirmation step.
 */
export async function previewAnnouncement(pool, payload) {
  const validation = validateAnnouncementDraft(payload);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const draft = validation.value;

  let cityName = null;
  if (draft.audience === 'CITY') {
    const city = await findCity(pool, draft.cityId);
    if (!city) return { ok: false, errors: cityErrors() };
    cityName = city.name_english;
  }
  const count = await countAudience(pool, { cutoff: new Date(), audience: draft.audience, cityId: draft.cityId });
  return { ok: true, count, audience: draft.audience, cityName };
}

function readConfirmedCount(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Sends the announcement: validates, recounts the audience at the send instant
 * and refuses if it differs from the number the administrator confirmed, then
 * writes one `announcements` row (PENDING) and one audit row in ONE
 * transaction. The send instant is the audience cutoff: accounts registered
 * after it never receive this announcement.
 */
export async function sendAnnouncement(pool, { adminId, payload }) {
  const validation = validateAnnouncementDraft(payload);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const draft = validation.value;

  const confirmedCount = readConfirmedCount(payload?.confirmedCount);
  if (confirmedCount === null) {
    return { ok: false, error: 'Confirm the number of recipients before sending.' };
  }

  try {
    return await runModerationTransaction(pool, async (client) => {
      let cityName = null;
      if (draft.audience === 'CITY') {
        const city = await findCity(client, draft.cityId);
        if (!city) throw new SendRefused({ ok: false, errors: cityErrors() });
        cityName = city.name_english;
      }

      const {
        rows: [{ cutoff }],
      } = await client.query('SELECT now() AS cutoff');
      const count = await countAudience(client, { cutoff, audience: draft.audience, cityId: draft.cityId });
      if (count !== confirmedCount) {
        throw new SendRefused({
          ok: false,
          currentCount: count,
          error: `The number of recipients changed to ${count.toLocaleString('en-US')} since you confirmed. Review it and send again.`,
        });
      }
      if (count === 0) {
        throw new SendRefused({ ok: false, error: 'There are no eligible users for this audience.' });
      }

      const { rows } = await client.query(
        `INSERT INTO announcements
           (sent_by_admin_id, audience, audience_city_id, audience_city_name,
            title_en, body_en, title_ar, body_ar, audience_cutoff_at, expected_recipients)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          adminId,
          draft.audience,
          draft.cityId,
          cityName,
          draft.titleEn,
          draft.bodyEn,
          draft.titleAr,
          draft.bodyAr,
          cutoff,
          count,
        ],
      );
      const id = rows[0].id;

      await client.query(
        `INSERT INTO moderation_actions
           (admin_user_id, action_type, target_type, target_id, reason, metadata)
         VALUES ($1, 'ANNOUNCEMENT_SENT', 'ANNOUNCEMENT', $2, NULL, $3)`,
        [
          adminId,
          id,
          JSON.stringify({ audience: draft.audience, cityId: draft.cityId, cityName, expectedRecipients: count }),
        ],
      );
      return { ok: true, id, count };
    });
  } catch (error) {
    if (error instanceof SendRefused) return error.result;
    throw error;
  }
}

function refuseUnlessSuperAdmin(context) {
  if (isSuperAdmin(context)) return null;
  return { ok: false, notice: { type: 'error', message: NOT_SUPER_ADMIN } };
}

/** `previewAnnouncement` resource action: validation plus the exact recipient count. */
export function buildPreviewAnnouncementAction(pool) {
  return {
    actionType: 'resource',
    isAccessible: isSuperAdmin,
    isVisible: false,
    component: false,
    handler: async (request, _response, context) => {
      const refusal = refuseUnlessSuperAdmin(context);
      if (refusal) return refusal;
      if (request.method !== 'post') return { ok: false };
      const result = await previewAnnouncement(pool, request.payload);
      if (!result.ok) {
        return { ...result, notice: { type: 'error', message: 'Check the highlighted fields.' } };
      }
      return result;
    },
  };
}

/** `new` resource action: the send. */
export function buildSendAnnouncementAction(pool) {
  return {
    actionType: 'resource',
    isAccessible: isSuperAdmin,
    handler: async (request, _response, context) => {
      const refusal = refuseUnlessSuperAdmin(context);
      if (refusal) return refusal;
      if (request.method !== 'post') return { ok: false };

      const result = await sendAnnouncement(pool, {
        adminId: context.currentAdmin.id,
        payload: request.payload,
      });
      if (result.ok) {
        const people = result.count === 1 ? 'user' : 'users';
        return {
          ...result,
          notice: {
            type: 'success',
            message: `Announcement queued for ${result.count.toLocaleString('en-US')} ${people}. It is delivered in the background.`,
          },
        };
      }
      return {
        ...result,
        notice: {
          type: 'error',
          message: result.error ?? 'Check the highlighted fields.',
        },
      };
    },
  };
}

/**
 * Live push breakdown per announcement, read from the push intents themselves.
 * Bounded by a short statement timeout: a very large announcement must never
 * make the history page hang, so on any error the figures are simply absent.
 */
export async function loadPushStats(pool, announcementIds) {
  const stats = new Map();
  if (!announcementIds.length || typeof pool?.connect !== 'function') return stats;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '3s'");
    const { rows } = await client.query(
      `SELECT n.announcement_id AS id,
              count(*) FILTER (WHERE pd.status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE pd.status IN ('PENDING', 'PROCESSING'))::int AS pending,
              count(*) FILTER (WHERE pd.status = 'SUPPRESSED')::int AS suppressed,
              count(*) FILTER (WHERE pd.status = 'FAILED')::int AS failed
       FROM notifications n
       JOIN push_deliveries pd ON pd.notification_id = n.id
       WHERE n.announcement_id = ANY($1::uuid[])
       GROUP BY n.announcement_id`,
      [announcementIds],
    );
    await client.query('COMMIT');
    for (const row of rows) stats.set(row.id, row);
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The figures are optional; keep the page working.
    }
  } finally {
    client.release();
  }
  return stats;
}

/** `after` hook for list and show: adds the live push figures to each record's params. */
export function attachPushStats(pool) {
  return async (response) => {
    const records = response?.records ?? (response?.record ? [response.record] : []);
    const ids = records.map((record) => record.params?.id).filter(Boolean);
    const stats = await loadPushStats(pool, ids);
    for (const record of records) {
      const row = stats.get(record.params?.id);
      if (!row) continue;
      record.params.push_delivered = row.delivered;
      record.params.push_pending = row.pending;
      record.params.push_suppressed = row.suppressed;
      record.params.push_failed = row.failed;
    }
    return response;
  };
}
