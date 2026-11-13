/**
 * Admin Announcement contract, shared by the Nest API and the AdminJS service.
 *
 * The AdminJS service imports this file directly at runtime (Node type
 * stripping, like the other shared contracts), so it must stay dependency free:
 * no value imports, no enums, no decorators. The validation rules and the
 * eligibility SQL live here once, so the "Send to N users" count an
 * administrator confirms can never drift from the audience the fan-out
 * delivers to.
 */

export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 80;
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 500;

export const ANNOUNCEMENT_AUDIENCES = ['ALL', 'CITY'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** PENDING -> SENDING -> SENT, or FAILED with a stored reason. */
export const ANNOUNCEMENT_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/**
 * Recipients handled per fan-out transaction. One batch inserts at most this
 * many notifications plus their push intents, so a batch stays well below a
 * second of database work and a crash re-does at most one batch.
 */
export const ANNOUNCEMENT_FAN_OUT_BATCH_SIZE = 500;

/** Consecutive failed batches before an announcement is marked FAILED. */
export const MAX_ANNOUNCEMENT_ATTEMPTS = 5;

export type AnnouncementDraftField = 'titleEn' | 'bodyEn' | 'titleAr' | 'bodyAr' | 'audience' | 'cityId';

export interface AnnouncementDraft {
  titleEn: string;
  bodyEn: string;
  titleAr: string;
  bodyAr: string;
  audience: AnnouncementAudience;
  cityId: string | null;
}

export type AnnouncementValidation =
  { ok: true; value: AnnouncementDraft } | { ok: false; errors: Partial<Record<AnnouncementDraftField, string>> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Arabic, Arabic Supplement, Arabic Extended-A and the two Arabic presentation-form blocks.
const ARABIC_LETTER = new RegExp('[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]');
const LATIN_LETTER = /[A-Za-z]/;
// Control characters other than tab and newline cannot be shown in a notification.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Length in characters as a person counts them (an emoji is one). */
export function characterLength(value: string): number {
  return Array.from(value).length;
}

type TextField = 'titleEn' | 'bodyEn' | 'titleAr' | 'bodyAr';

const TEXT_RULES: Record<TextField, { label: string; max: number; language: 'English' | 'Arabic' }> = {
  titleEn: { label: 'English title', max: ANNOUNCEMENT_TITLE_MAX_LENGTH, language: 'English' },
  bodyEn: { label: 'English message', max: ANNOUNCEMENT_BODY_MAX_LENGTH, language: 'English' },
  titleAr: { label: 'Arabic title', max: ANNOUNCEMENT_TITLE_MAX_LENGTH, language: 'Arabic' },
  bodyAr: { label: 'Arabic message', max: ANNOUNCEMENT_BODY_MAX_LENGTH, language: 'Arabic' },
};

/**
 * Validates and normalizes an announcement an administrator composed. Both
 * languages are required: a person receives the language of their account, so
 * a missing translation would be a blank notification for half the audience.
 */
export function validateAnnouncementDraft(raw: unknown): AnnouncementValidation {
  const errors: Partial<Record<AnnouncementDraftField, string>> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { titleEn: 'Enter the announcement.' } };
  }
  const input = raw as Record<string, unknown>;

  const text = {} as Record<TextField, string>;
  for (const field of Object.keys(TEXT_RULES) as TextField[]) {
    const rule = TEXT_RULES[field];
    const raw = input[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    text[field] = value;
    if (!value) {
      errors[field] = `Enter the ${rule.label.toLowerCase()}.`;
    } else if (FORBIDDEN_CONTROL.test(value)) {
      errors[field] = `The ${rule.label.toLowerCase()} contains a character that cannot be shown.`;
    } else if (characterLength(value) > rule.max) {
      errors[field] = `The ${rule.label.toLowerCase()} must be at most ${rule.max} characters.`;
    } else if (rule.language === 'Arabic' && !ARABIC_LETTER.test(value)) {
      errors[field] = `The ${rule.label.toLowerCase()} must be written in Arabic.`;
    } else if (rule.language === 'English' && !LATIN_LETTER.test(value)) {
      errors[field] = `The ${rule.label.toLowerCase()} must be written in English.`;
    }
  }

  const audience = input.audience;
  let cityId: string | null = null;
  if (!ANNOUNCEMENT_AUDIENCES.includes(audience as AnnouncementAudience)) {
    errors.audience = 'Choose who receives the announcement.';
  } else if (audience === 'CITY') {
    const candidate = typeof input.cityId === 'string' ? input.cityId.trim() : '';
    if (!UUID_PATTERN.test(candidate)) {
      errors.cityId = 'Choose a City.';
    } else {
      cityId = candidate.toLowerCase();
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...text, audience: audience as AnnouncementAudience, cityId } };
}

/**
 * The one definition of an eligible recipient. Placeholders: `$1` audience
 * cutoff (accounts registered after it are not recipients), `$2` audience
 * (`ALL` or `CITY`), `$3` home City id (read only for `CITY`). The alias `u`
 * is the `users` table.
 *
 * - Banned accounts are excluded.
 * - An account with any deletion request is excluded: the sign-in guard blocks
 *   PENDING, COMPLETED and FAILED requests alike, matched by account id or by
 *   Firebase identity, so the audience does too.
 * - Notification preferences do not matter here: every eligible account gets
 *   the in-app notification, and only push honours the preference.
 */
export const ELIGIBLE_AUDIENCE_PREDICATE = `u.is_banned = false
  AND u.created_at <= $1::timestamptz
  AND ($2::text = 'ALL' OR u.home_city_id = $3::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM account_deletions ad
    WHERE ad.user_id = u.id OR ad.firebase_user_id = u.firebase_user_id
  )`;

export interface AudienceParams {
  cutoff: Date | string;
  audience: AnnouncementAudience;
  cityId: string | null;
}

/** Positional-parameter values for {@link ELIGIBLE_AUDIENCE_PREDICATE}. */
export function audienceValues(params: AudienceParams): [string, AnnouncementAudience, string | null] {
  if (params.audience === 'CITY' && !params.cityId) {
    throw new TypeError('A city audience needs a City id.');
  }
  const cutoff = params.cutoff instanceof Date ? params.cutoff.toISOString() : params.cutoff;
  return [cutoff, params.audience, params.audience === 'CITY' ? params.cityId : null];
}

/** Exact number of eligible recipients; what the confirmation step shows. */
export function buildAudienceCountQuery(params: AudienceParams): { text: string; values: unknown[] } {
  return {
    text: `SELECT count(*)::int AS count FROM users u WHERE ${ELIGIBLE_AUDIENCE_PREDICATE}`,
    values: audienceValues(params),
  };
}
