import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ELIGIBLE_AUDIENCE_PREDICATE } from '../../../../src/notifications/admin-announcement.contract.ts';
import {
  buildPreviewAnnouncementAction,
  buildSendAnnouncementAction,
  previewAnnouncement,
  sendAnnouncement,
} from './announcement.actions.js';

const CITY_ID = '01916327-0000-7000-8000-0000000000c1';
const ADMIN_ID = '01916327-0000-7000-8000-0000000000a1';
const KEY = '3f6c1f0e-8a52-4b6e-9d57-0a6f3f0b7c11';

const draft = (overrides = {}) => ({
  titleEn: 'Vaccination week',
  bodyEn: 'Free rabies shots this week.',
  titleAr: 'أسبوع التطعيم',
  bodyAr: 'تطعيم مجاني هذا الأسبوع.',
  audience: 'ALL',
  cityId: '',
  ...overrides,
});

/** Fake pool: scripted answers by SQL text, and a record of everything run. */
function fakePool({
  count = 3,
  city = { id: CITY_ID, name_english: 'Cairo' },
  existing = null,
  conflict = false,
} = {}) {
  const log = [];
  const answer = (text, values) => {
    log.push({ text, values });
    if (/FROM cities/.test(text)) return { rows: city ? [city] : [] };
    if (/FROM announcements WHERE request_key/.test(text)) return { rows: existing ? [existing] : [] };
    if (/count\(\*\)/.test(text)) return { rows: [{ count }] };
    if (/SELECT now\(\)/.test(text)) return { rows: [{ cutoff: new Date('2026-11-13T10:00:00.000Z') }] };
    if (/INSERT INTO announcements/.test(text)) return { rows: conflict ? [] : [{ id: 'announcement-1' }] };
    if (/INSERT INTO moderation_actions/.test(text)) return { rows: [{ id: 'audit-1' }] };
    return { rows: [] };
  };
  const client = { query: async (text, values) => answer(text, values), release() {} };
  return { log, query: async (text, values) => answer(text, values), connect: async () => client };
}

const sentTexts = (pool) => pool.log.map((entry) => entry.text.trim().split(/\s+/).slice(0, 3).join(' '));

const stored = (overrides = {}) => ({
  audience: 'ALL',
  audience_city_id: null,
  title_en: 'Vaccination week',
  body_en: 'Free rabies shots this week.',
  title_ar: 'أسبوع التطعيم',
  body_ar: 'تطعيم مجاني هذا الأسبوع.',
  ...overrides,
});

describe('previewAnnouncement', () => {
  it('returns field errors without touching the database', async () => {
    const pool = fakePool();
    const result = await previewAnnouncement(pool, draft({ titleEn: '', bodyAr: 'English text' }));
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['bodyAr', 'titleEn']);
    assert.equal(pool.log.length, 0);
  });

  it('counts recipients with the shared eligibility SQL', async () => {
    const pool = fakePool({ count: 1234 });
    const result = await previewAnnouncement(pool, draft());
    assert.deepEqual(result, { ok: true, count: 1234, audience: 'ALL', cityName: null });
    const count = pool.log.find((entry) => /count\(\*\)/.test(entry.text));
    assert.ok(count.text.includes(ELIGIBLE_AUDIENCE_PREDICATE), 'the count must reuse the shared predicate');
    assert.equal(count.values[1], 'ALL');
  });

  it('names the City of a city audience and counts only that City', async () => {
    const pool = fakePool({ count: 40 });
    const result = await previewAnnouncement(pool, draft({ audience: 'CITY', cityId: CITY_ID }));
    assert.deepEqual(result, { ok: true, count: 40, audience: 'CITY', cityName: 'Cairo' });
    const count = pool.log.find((entry) => /count\(\*\)/.test(entry.text));
    assert.deepEqual(count.values.slice(1), ['CITY', CITY_ID]);
  });

  it('refuses a City that does not exist', async () => {
    const pool = fakePool({ city: null });
    const result = await previewAnnouncement(pool, draft({ audience: 'CITY', cityId: CITY_ID }));
    assert.equal(result.ok, false);
    assert.match(result.errors.cityId, /City/);
    assert.equal(
      pool.log.some((entry) => /count\(\*\)/.test(entry.text)),
      false,
    );
  });
});

describe('sendAnnouncement', () => {
  const send = (pool, overrides = {}, extra = {}) =>
    sendAnnouncement(pool, {
      adminId: ADMIN_ID,
      payload: { ...draft(overrides), confirmedCount: 3, requestKey: KEY, ...extra },
    });

  it('writes one announcement and one audit row in one transaction and creates no notifications', async () => {
    const pool = fakePool({ count: 3 });
    const result = await send(pool);
    assert.deepEqual(result, { ok: true, id: 'announcement-1', count: 3 });

    const statements = pool.log.map((entry) => entry.text);
    assert.equal(statements.filter((text) => /INSERT INTO announcements/.test(text)).length, 1);
    assert.equal(statements.filter((text) => /INSERT INTO moderation_actions/.test(text)).length, 1);
    assert.equal(
      statements.some((text) => /notifications|push_deliveries/.test(text.replace(/FROM users u[\s\S]*/, ''))),
      false,
      'the admin request never touches notifications or push intents',
    );
    const audit = pool.log.find((entry) => /INSERT INTO moderation_actions/.test(entry.text));
    assert.ok(audit.text.includes('ANNOUNCEMENT_SENT'));
    assert.equal(audit.values[0], ADMIN_ID);
    assert.equal(audit.values[1], 'announcement-1');
    const order = sentTexts(pool);
    assert.equal(order[0], 'BEGIN');
    assert.equal(order.at(-1), 'COMMIT');
  });

  it('stores the cutoff and the confirmed count with the announcement', async () => {
    const pool = fakePool({ count: 3 });
    await send(pool);
    const insert = pool.log.find((entry) => /INSERT INTO announcements/.test(entry.text));
    assert.ok(insert.values.includes(ADMIN_ID));
    assert.ok(insert.values.includes(3));
    assert.ok(insert.values.some((value) => value instanceof Date || /^2026-11-13T10:00:00/.test(String(value))));
  });

  it('refuses invalid text without writing anything', async () => {
    const pool = fakePool();
    const result = await send(pool, { titleAr: '' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.titleAr);
    assert.equal(pool.log.length, 0);
  });

  it('refuses a send that was not confirmed with a count', async () => {
    for (const confirmedCount of [undefined, null, '', 'many', -1, 1.5]) {
      const pool = fakePool();
      const result = await sendAnnouncement(pool, {
        adminId: ADMIN_ID,
        payload: { ...draft(), confirmedCount, requestKey: KEY },
      });
      assert.equal(result.ok, false, String(confirmedCount));
      assert.match(result.error, /confirm/i);
      assert.equal(pool.log.length, 0);
    }
  });

  it('refuses when the audience changed since it was confirmed and reports the new count', async () => {
    const pool = fakePool({ count: 5 });
    const result = await send(pool, {}, { confirmedCount: 3 });
    assert.equal(result.ok, false);
    assert.equal(result.currentCount, 5);
    assert.match(result.error, /5/);
    assert.equal(
      pool.log.some((entry) => /INSERT INTO/.test(entry.text)),
      false,
    );
    assert.equal(sentTexts(pool).at(-1), 'ROLLBACK');
  });

  it('refuses an announcement nobody would receive', async () => {
    const pool = fakePool({ count: 0 });
    const result = await send(pool, {}, { confirmedCount: 0 });
    assert.equal(result.ok, false);
    assert.match(result.error, /no eligible/i);
    assert.equal(
      pool.log.some((entry) => /INSERT INTO/.test(entry.text)),
      false,
    );
  });

  it('rejects a send without a valid request key before touching the database', async () => {
    for (const requestKey of [undefined, null, '', 'not-a-uuid', 42]) {
      const pool = fakePool();
      const result = await sendAnnouncement(pool, {
        adminId: ADMIN_ID,
        payload: { ...draft(), confirmedCount: 3, requestKey },
      });
      assert.equal(result.ok, false, String(requestKey));
      assert.match(result.error, /request key/i);
      assert.equal(pool.log.length, 0);
    }
  });

  it('returns the existing announcement when the request key was already used', async () => {
    const existing = { id: 'announcement-0', expected_recipients: 3, ...stored() };
    const pool = fakePool({ existing });
    const result = await send(pool);
    assert.deepEqual(result, { ok: true, id: 'announcement-0', count: 3 });
    assert.equal(
      pool.log.some((entry) => /INSERT INTO/.test(entry.text)),
      false,
      'a replay writes neither an announcement nor an audit row',
    );
  });

  it('refuses a key that was used for a different announcement', async () => {
    const existing = { id: 'announcement-0', expected_recipients: 3, ...stored({ title_en: 'Something else' }) };
    const result = await send(fakePool({ existing }));
    assert.equal(result.ok, false);
    assert.match(result.error, /different announcement/i);
  });

  it('treats a lost race on the request key as a replay and writes no audit row', async () => {
    const existing = { id: 'announcement-0', expected_recipients: 3, ...stored() };
    const pool = fakePool({ conflict: true });
    let lookups = 0;
    const original = pool.connect;
    pool.connect = async () => {
      const client = await original();
      const query = client.query;
      client.query = async (text, values) => {
        if (/FROM announcements WHERE request_key/.test(text)) {
          lookups += 1;
          // Nothing yet at the first look; the other request's row after the conflict.
          return { rows: lookups === 1 ? [] : [existing] };
        }
        return query(text, values);
      };
      return client;
    };
    const result = await send(pool);
    assert.deepEqual(result, { ok: true, id: 'announcement-0', count: 3 });
    assert.equal(
      pool.log.some((entry) => /INSERT INTO moderation_actions/.test(entry.text)),
      false,
    );
  });

  it('accepts the confirmed count as the string a form posts', async () => {
    const pool = fakePool({ count: 3 });
    const result = await send(pool, {}, { confirmedCount: '3' });
    assert.equal(result.ok, true);
  });
});

describe('announcement action handlers', () => {
  const request = (payload) => ({ method: 'post', payload });
  const asSuper = { currentAdmin: { id: ADMIN_ID, role: 'SUPER_ADMIN' } };
  const asStaff = { currentAdmin: { id: ADMIN_ID, role: 'ADMIN' } };

  it('refuse a plain admin even if the action gate were bypassed', async () => {
    for (const build of [buildPreviewAnnouncementAction, buildSendAnnouncementAction]) {
      const pool = fakePool();
      const action = build(pool);
      const response = await action.handler(request({ ...draft(), confirmedCount: 3, requestKey: KEY }), {}, asStaff);
      assert.equal(response.notice.type, 'error');
      assert.match(response.notice.message, /super admin/i);
      assert.equal(pool.log.length, 0);
    }
  });

  it('send answers with a success notice and the new record id', async () => {
    const pool = fakePool({ count: 3 });
    const response = await buildSendAnnouncementAction(pool).handler(
      request({ ...draft(), confirmedCount: 3, requestKey: KEY }),
      {},
      asSuper,
    );
    assert.equal(response.ok, true);
    assert.equal(response.id, 'announcement-1');
    assert.equal(response.notice.type, 'success');
  });

  it('send answers a stale count with an error notice and the current count', async () => {
    const pool = fakePool({ count: 9 });
    const response = await buildSendAnnouncementAction(pool).handler(
      request({ ...draft(), confirmedCount: 3, requestKey: KEY }),
      {},
      asSuper,
    );
    assert.equal(response.ok, false);
    assert.equal(response.currentCount, 9);
    assert.equal(response.notice.type, 'error');
  });

  it('preview answers validation errors as data, not an exception', async () => {
    const response = await buildPreviewAnnouncementAction(fakePool()).handler(
      request(draft({ titleEn: '' })),
      {},
      asSuper,
    );
    assert.equal(response.ok, false);
    assert.ok(response.errors.titleEn);
  });
});
