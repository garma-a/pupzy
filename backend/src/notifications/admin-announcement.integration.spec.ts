import { TestDatabaseHelper } from '../../test/test-database.helper';
import { PushDeliveryProcessor } from './push-delivery.processor';
import type { PushDeliveryMessage, PushProvider } from './push.provider';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { AdminAnnouncementRepository } from './admin-announcement.repository';
import { AdminAnnouncementProcessor } from './admin-announcement.processor';
import { MAX_ANNOUNCEMENT_ATTEMPTS, buildAudienceCountQuery } from './admin-announcement.contract';

/**
 * Admin Announcement fan-out against a real PostGIS database.
 *
 * ~2,500 accounts across two Cities with mixed languages, push preferences,
 * devices, bans and deletion requests. Expectations are computed from the seed
 * formulas below, independently of the SQL under test.
 */

const USER_COUNT = 2_500;
const BATCH_SIZE = 500;

/** Seed model: every attribute is a pure function of the account number. */
const model = {
  city: (i: number): 'CAIRO' | 'ALEX' | null => (i % 10 === 0 ? null : i % 2 === 0 ? 'CAIRO' : 'ALEX'),
  language: (i: number): string | null => (i % 50 === 7 ? 'fr' : i % 3 === 0 ? 'ar' : i % 3 === 1 ? 'en' : null),
  notificationsEnabled: (i: number): boolean => i % 4 !== 0,
  banned: (i: number): boolean => i % 25 === 0,
  deletionRequested: (i: number): boolean => i % 40 === 1,
  devices: (i: number): number => (i % 5 === 0 ? 0 : i % 7 === 0 ? 2 : 1),
  eligible: (i: number): boolean => !model.banned(i) && !model.deletionRequested(i),
};

const numbers = Array.from({ length: USER_COUNT }, (_, index) => index + 1);
const eligibleNumbers = (city?: 'CAIRO' | 'ALEX') =>
  numbers.filter((i) => model.eligible(i) && (city === undefined || model.city(i) === city));
const expectedIntents = (list: number[]) =>
  list.filter((i) => model.notificationsEnabled(i)).reduce((total, i) => total + model.devices(i), 0);

class RecordingPushProvider implements PushProvider {
  readonly sent: PushDeliveryMessage[] = [];
  send(message: PushDeliveryMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe('Admin Announcement fan-out (integration)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let processor: AdminAnnouncementProcessor;
  let cairoId: string;
  let alexId: string;
  let adminId: string;
  let userIdByNumber: Map<number, string>;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    processor = new AdminAnnouncementProcessor(dbHelper.db, new AdminAnnouncementRepository(dbHelper.db));

    const cityRows = await dbHelper.pool.query<{ id: string; name_english: string }>(`
      INSERT INTO cities (name_english, name_arabic, governorate, center_point) VALUES
        ('Cairo', 'القاهرة', 'Cairo', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)),
        ('Alexandria', 'الإسكندرية', 'Alexandria', ST_SetSRID(ST_MakePoint(29.9187, 31.2001), 4326))
      RETURNING id, name_english
    `);
    cairoId = cityRows.rows.find((r) => r.name_english === 'Cairo')!.id;
    alexId = cityRows.rows.find((r) => r.name_english === 'Alexandria')!.id;

    const admin = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, full_name, role)
       VALUES ('super@example.com', 'x', 'Super Admin', 'SUPER_ADMIN') RETURNING id`,
    );
    adminId = admin.rows[0].id;

    // Seeded a day in the past so they are before any announcement cutoff.
    await dbHelper.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, language_preference,
                          notifications_enabled, is_banned, created_at)
       SELECT 'fb-' || g, 'u' || g || '@example.com', 'User ' || g,
              CASE WHEN g % 10 = 0 THEN NULL WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END,
              CASE WHEN g % 50 = 7 THEN 'fr' WHEN g % 3 = 0 THEN 'ar' WHEN g % 3 = 1 THEN 'en' ELSE NULL END,
              g % 4 <> 0,
              g % 25 = 0,
              now() - interval '1 day'
       FROM generate_series(1, $3::int) g`,
      [cairoId, alexId, USER_COUNT],
    );
    const users = await dbHelper.pool.query<{ id: string; firebase_user_id: string }>(
      `SELECT id, firebase_user_id FROM users`,
    );
    userIdByNumber = new Map(users.rows.map((row) => [Number(row.firebase_user_id.slice(3)), row.id]));

    // Deletion requests of mixed status: the account row still exists while it is cleaned up.
    await dbHelper.pool.query(
      `INSERT INTO account_deletions (user_id, firebase_user_id, email, status, step, progress_token_hash)
       SELECT u.id, u.firebase_user_id, u.email,
              CASE WHEN g % 80 = 1 THEN 'FAILED' ELSE 'PENDING' END::account_deletion_status,
              'ACCEPTED', 'hash-' || g
       FROM generate_series(1, $1::int) g
       JOIN users u ON u.firebase_user_id = 'fb-' || g
       WHERE g % 40 = 1`,
      [USER_COUNT],
    );
    await dbHelper.pool.query(
      `INSERT INTO device_registrations (user_id, token, platform)
       SELECT u.id, 'token-' || g || '-' || d, 'ANDROID'
       FROM generate_series(1, $1::int) g
       CROSS JOIN generate_series(1, 2) d
       JOIN users u ON u.firebase_user_id = 'fb-' || g
       WHERE d <= CASE WHEN g % 5 = 0 THEN 0 WHEN g % 7 = 0 THEN 2 ELSE 1 END`,
      [USER_COUNT],
    );
  });

  /** What the AdminJS send action writes: one row, PENDING, cutoff at send time. */
  async function sendAnnouncement(
    options: { audience?: 'ALL' | 'CITY'; cityId?: string | null; expected?: number } = {},
  ): Promise<string> {
    const audience = options.audience ?? 'ALL';
    const cityId = audience === 'CITY' ? (options.cityId ?? cairoId) : null;
    const count = options.expected ?? (await countEligible(audience, cityId));
    const { rows } = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO announcements (sent_by_admin_id, audience, audience_city_id, title_en, body_en, title_ar, body_ar,
                                  expected_recipients)
       VALUES ($1, $2, $3, 'Vaccination week', 'Free rabies shots at partner clinics.',
               'أسبوع التطعيم', 'تطعيم مجاني ضد السعار في العيادات الشريكة.', $4)
       RETURNING id`,
      [adminId, audience, cityId, count],
    );
    return rows[0].id;
  }

  async function countEligible(audience: 'ALL' | 'CITY', cityId: string | null): Promise<number> {
    const query = buildAudienceCountQuery({ cutoff: new Date(Date.now() + 60_000), audience, cityId });
    const { rows } = await dbHelper.pool.query<{ count: number }>(query.text, query.values);
    return rows[0].count;
  }

  async function announcementRow(id: string) {
    const { rows } = await dbHelper.pool.query(`SELECT * FROM announcements WHERE id = $1`, [id]);
    return rows[0] as {
      status: string;
      in_app_count: number;
      push_intent_count: number;
      cursor_user_id: string | null;
      attempts: number;
      last_error: string | null;
      failure_reason: string | null;
      next_attempt_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    };
  }

  async function recipientNumbers(id: string): Promise<number[]> {
    const { rows } = await dbHelper.pool.query<{ firebase_user_id: string }>(
      `SELECT u.firebase_user_id FROM notifications n JOIN users u ON u.id = n.recipient_id
       WHERE n.announcement_id = $1`,
      [id],
    );
    return rows.map((row) => Number(row.firebase_user_id.slice(3))).sort((a, b) => a - b);
  }

  async function notificationTotal(id: string): Promise<number> {
    const { rows } = await dbHelper.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM notifications WHERE announcement_id = $1`,
      [id],
    );
    return rows[0].count;
  }

  async function intentTotal(id: string): Promise<number> {
    const { rows } = await dbHelper.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM push_deliveries pd
       JOIN notifications n ON n.id = pd.notification_id WHERE n.announcement_id = $1`,
      [id],
    );
    return rows[0].count;
  }

  it('sanity: the seed model matches the database', async () => {
    expect(await countEligible('ALL', null)).toBe(eligibleNumbers().length);
    expect(await countEligible('CITY', cairoId)).toBe(eligibleNumbers('CAIRO').length);
    expect(await countEligible('CITY', alexId)).toBe(eligibleNumbers('ALEX').length);
    // The model excludes both banned and deletion-requested accounts.
    expect(eligibleNumbers().length).toBeLessThan(USER_COUNT - 99);
  });

  it('creates exactly one in-app notification per eligible account, in batches, and ends SENT', async () => {
    const id = await sendAnnouncement();
    expect((await announcementRow(id)).status).toBe('PENDING');

    const result = await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    const expected = eligibleNumbers();
    expect(await recipientNumbers(id)).toEqual(expected);
    expect(result.batchesProcessed).toBe(Math.ceil(expected.length / BATCH_SIZE));
    const { rows } = await dbHelper.pool.query<{ per_recipient: number }>(
      `SELECT count(*)::int AS per_recipient FROM notifications WHERE announcement_id = $1
       GROUP BY recipient_id HAVING count(*) > 1`,
      [id],
    );
    expect(rows).toEqual([]);

    const row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(expected.length);
    expect(row.attempts).toBe(0);
    expect(row.started_at).toBeInstanceOf(Date);
    expect(row.completed_at).toBeInstanceOf(Date);
  });

  it('stores the announcement as an ADMIN_ANNOUNCEMENT with both languages and no related post', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    const { rows } = await dbHelper.pool.query(
      `SELECT DISTINCT type, title, body, title_arabic, body_arabic, related_post_id, related_comment_id,
                       related_contact_request_id, related_application_id, is_read
       FROM notifications WHERE announcement_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'Vaccination week',
        body: 'Free rabies shots at partner clinics.',
        title_arabic: 'أسبوع التطعيم',
        body_arabic: 'تطعيم مجاني ضد السعار في العيادات الشريكة.',
        related_post_id: null,
        related_comment_id: null,
        related_contact_request_id: null,
        related_application_id: null,
        is_read: false,
      },
    ]);
  });

  it('shows each recipient the announcement in their language preference (English by default)', async () => {
    await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    const service = new NotificationsService(new NotificationsRepository(dbHelper.db));

    const expectations: Array<[number, string | null, string]> = [
      [3, 'ar', 'أسبوع التطعيم'], // Arabic preference
      [4, 'en', 'Vaccination week'], // English preference
      [2, null, 'Vaccination week'], // never synchronized a language
      [7, 'fr', 'Vaccination week'], // unknown value falls back to English
    ];
    for (const [number, preference, title] of expectations) {
      expect(model.language(number)).toBe(preference);
      expect(model.eligible(number)).toBe(true);
      const inbox = await service.getMyNotifications(userIdByNumber.get(number)!, 5, null, preference);
      expect(inbox.edges).toHaveLength(1);
      expect(inbox.edges[0].node.type).toBe('ADMIN_ANNOUNCEMENT');
      expect(inbox.edges[0].node.title).toBe(title);
      expect(inbox.unreadCount).toBe(1);
    }
    const arabic = await service.getMyNotifications(userIdByNumber.get(3)!, 5, null, 'ar');
    expect(arabic.edges[0].node.body).toBe('تطعيم مجاني ضد السعار في العيادات الشريكة.');
  });

  it('writes push intents only for opted-in recipients, one per registered device', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    const expected = expectedIntents(eligibleNumbers());
    expect(expected).toBeGreaterThan(500);
    expect(await intentTotal(id)).toBe(expected);
    expect((await announcementRow(id)).push_intent_count).toBe(expected);

    const { rows } = await dbHelper.pool.query<{ firebase_user_id: string; intents: number }>(
      `SELECT u.firebase_user_id, count(*)::int AS intents
       FROM push_deliveries pd
       JOIN notifications n ON n.id = pd.notification_id
       JOIN users u ON u.id = pd.recipient_id
       WHERE n.announcement_id = $1 GROUP BY u.firebase_user_id`,
      [id],
    );
    for (const row of rows) {
      const number = Number(row.firebase_user_id.slice(3));
      expect(model.notificationsEnabled(number)).toBe(true); // opted-out accounts get no intent
      expect(model.devices(number)).toBeGreaterThan(0); // accounts without a device get no intent
      expect(row.intents).toBe(model.devices(number));
    }
    // The in-app notification is created for opted-out and device-less accounts too.
    const optedOut = eligibleNumbers().find((i) => !model.notificationsEnabled(i))!;
    expect(await recipientNumbers(id)).toContain(optedOut);
    const { rows: noActor } = await dbHelper.pool.query(
      `SELECT 1 FROM push_deliveries pd JOIN notifications n ON n.id = pd.notification_id
       WHERE n.announcement_id = $1 AND pd.actor_id IS NOT NULL LIMIT 1`,
      [id],
    );
    expect(noActor).toEqual([]);
  });

  it('gives banned accounts and accounts with a deletion request nothing', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    const recipients = new Set(await recipientNumbers(id));

    const banned = numbers.filter(model.banned);
    const deleted = numbers.filter(model.deletionRequested);
    expect(banned.length).toBeGreaterThan(50);
    expect(deleted.length).toBeGreaterThan(30);
    for (const i of [...banned, ...deleted]) expect(recipients.has(i)).toBe(false);

    const { rows } = await dbHelper.pool.query(
      `SELECT 1 FROM push_deliveries pd JOIN notifications n ON n.id = pd.notification_id
       JOIN users u ON u.id = pd.recipient_id
       WHERE n.announcement_id = $1 AND (u.is_banned OR EXISTS (SELECT 1 FROM account_deletions ad WHERE ad.user_id = u.id))`,
      [id],
    );
    expect(rows).toEqual([]);
  });

  it('rechecks eligibility per batch: an account banned after sending but before its batch gets nothing', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 1 });
    const done = new Set(await recipientNumbers(id));
    const later = eligibleNumbers().find((i) => !done.has(i))!;
    await dbHelper.pool.query(`UPDATE users SET is_banned = true WHERE id = $1`, [userIdByNumber.get(later)!]);

    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    expect(await recipientNumbers(id)).not.toContain(later);
    const row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(eligibleNumbers().length - 1);
  });

  it('sends a City announcement only to eligible accounts whose home City is that City', async () => {
    const cairo = await sendAnnouncement({ audience: 'CITY', cityId: cairoId });
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    expect(await recipientNumbers(cairo)).toEqual(eligibleNumbers('CAIRO'));
    expect((await announcementRow(cairo)).in_app_count).toBe(eligibleNumbers('CAIRO').length);
    expect(await intentTotal(cairo)).toBe(expectedIntents(eligibleNumbers('CAIRO')));

    const alex = await sendAnnouncement({ audience: 'CITY', cityId: alexId });
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    const alexRecipients = await recipientNumbers(alex);
    expect(alexRecipients).toEqual(eligibleNumbers('ALEX'));
    // Accounts without a home City are in no City audience.
    for (const i of numbers.filter((n) => model.city(n) === null)) {
      expect(alexRecipients).not.toContain(i);
    }
  });

  it('an announcement for a City with no accounts completes as SENT with zero recipients', async () => {
    const { rows } = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO cities (name_english, name_arabic, governorate, center_point)
       VALUES ('Siwa', 'سيوة', 'Matrouh', ST_SetSRID(ST_MakePoint(25.5, 29.2), 4326)) RETURNING id`,
    );
    const id = await sendAnnouncement({ audience: 'CITY', cityId: rows[0].id, expected: 0 });
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    const row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(0);
    expect(await notificationTotal(id)).toBe(0);
  });

  it('gives nothing to accounts that registered after the announcement was sent', async () => {
    const id = await sendAnnouncement();
    // Same City as the audience, registered after the cutoff and before the fan-out runs.
    await dbHelper.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, created_at)
       SELECT 'fb-late-' || g, 'late' || g || '@example.com', 'Late ' || g, $1::uuid, now() + interval '5 seconds'
       FROM generate_series(1, 30) g`,
      [cairoId],
    );
    // And one registered between batches of a running fan-out.
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 2 });
    await dbHelper.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id)
       VALUES ('fb-mid', 'mid@example.com', 'Mid', $1)`,
      [cairoId],
    );
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    const { rows } = await dbHelper.pool.query(
      `SELECT 1 FROM notifications n JOIN users u ON u.id = n.recipient_id
       WHERE n.announcement_id = $1 AND (u.firebase_user_id LIKE 'fb-late-%' OR u.firebase_user_id = 'fb-mid')`,
      [id],
    );
    expect(rows).toEqual([]);
    expect(await recipientNumbers(id)).toHaveLength(eligibleNumbers().length);
  });

  it('moves PENDING to SENDING to SENT with accurate counts while batches run', async () => {
    const id = await sendAnnouncement();
    const total = eligibleNumbers().length;

    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 1 });
    let row = await announcementRow(id);
    expect(row.status).toBe('SENDING');
    expect(row.in_app_count).toBe(BATCH_SIZE);
    expect(row.cursor_user_id).not.toBeNull();
    expect(row.started_at).toBeInstanceOf(Date);
    expect(row.completed_at).toBeNull();
    expect(row.in_app_count).toBe(await notificationTotal(id));
    expect(row.push_intent_count).toBe(await intentTotal(id));

    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 2 });
    row = await announcementRow(id);
    expect(row.status).toBe('SENDING');
    expect(row.in_app_count).toBe(BATCH_SIZE * 3);

    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(total);
    expect(row.push_intent_count).toBe(await intentTotal(id));
    expect(row.completed_at).toBeInstanceOf(Date);
  });

  it('a batch that never commits leaves nothing behind, and a fresh worker resumes without duplicates', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 2 });
    const before = await announcementRow(id);
    expect(before.in_app_count).toBe(BATCH_SIZE * 2);

    // The worker dies after the batch wrote its rows and before the transaction commits.
    const crash = new Error('process killed mid-batch');
    await expect(
      dbHelper.db.transaction(async (tx) => {
        const outcome = await processor.processNextBatch(tx, BATCH_SIZE);
        expect(outcome?.notified).toBe(BATCH_SIZE);
        throw crash;
      }),
    ).rejects.toBe(crash);

    const afterCrash = await announcementRow(id);
    expect(afterCrash.cursor_user_id).toBe(before.cursor_user_id);
    expect(afterCrash.in_app_count).toBe(BATCH_SIZE * 2);
    expect(await notificationTotal(id)).toBe(BATCH_SIZE * 2);
    expect(await intentTotal(id)).toBe(before.push_intent_count);

    // A different process picks the announcement up where the cursor says.
    const resumed = new AdminAnnouncementProcessor(dbHelper.db, new AdminAnnouncementRepository(dbHelper.db));
    await resumed.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    expect(await recipientNumbers(id)).toEqual(eligibleNumbers());
    const row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(eligibleNumbers().length);
    expect(row.push_intent_count).toBe(expectedIntents(eligibleNumbers()));
    expect(await intentTotal(id)).toBe(expectedIntents(eligibleNumbers()));
  });

  it('a failed batch is retried with backoff and does not duplicate what already committed', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 1 });

    const repository = new AdminAnnouncementRepository(dbHelper.db);
    const failing = new AdminAnnouncementProcessor(dbHelper.db, repository);
    jest.spyOn(repository, 'recordProgress').mockRejectedValueOnce(new Error('connection reset'));
    const result = await failing.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    expect(result.failedBatches).toBe(1);
    let row = await announcementRow(id);
    expect(row.status).toBe('SENDING');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('connection reset');
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    expect(row.in_app_count).toBe(BATCH_SIZE); // the failed batch rolled back entirely
    expect(await notificationTotal(id)).toBe(BATCH_SIZE);

    // Still backing off: a pass does nothing.
    expect((await failing.processPendingAnnouncements({ batchSize: BATCH_SIZE })).batchesProcessed).toBe(0);

    await dbHelper.pool.query(`UPDATE announcements SET next_attempt_at = now() WHERE id = $1`, [id]);
    await failing.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(await recipientNumbers(id)).toEqual(eligibleNumbers());
  });

  it('marks the announcement FAILED with a reason after repeated failures and keeps what was delivered', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 1 });
    const repository = new AdminAnnouncementRepository(dbHelper.db);
    const failing = new AdminAnnouncementProcessor(dbHelper.db, repository);
    jest.spyOn(repository, 'recordProgress').mockRejectedValue(new Error('disk full'));

    for (let attempt = 0; attempt < MAX_ANNOUNCEMENT_ATTEMPTS; attempt++) {
      await dbHelper.pool.query(`UPDATE announcements SET next_attempt_at = now() WHERE id = $1`, [id]);
      await failing.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    }

    const row = await announcementRow(id);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(MAX_ANNOUNCEMENT_ATTEMPTS);
    expect(row.failure_reason).toContain('disk full');
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(row.in_app_count).toBe(BATCH_SIZE);

    // FAILED is terminal: later passes leave it alone.
    jest.restoreAllMocks();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    expect(await notificationTotal(id)).toBe(BATCH_SIZE);
  });

  it('is idempotent: re-walking an already delivered range creates no duplicates and no extra intents', async () => {
    const id = await sendAnnouncement();
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    const delivered = await announcementRow(id);

    // Simulate a lost cursor update: the cursor goes back to the start and the work is queued again.
    await dbHelper.pool.query(
      `UPDATE announcements SET status = 'SENDING', cursor_user_id = NULL, completed_at = NULL WHERE id = $1`,
      [id],
    );
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    expect(await notificationTotal(id)).toBe(delivered.in_app_count);
    expect(await intentTotal(id)).toBe(delivered.push_intent_count);
    const row = await announcementRow(id);
    expect(row.status).toBe('SENT');
    expect(row.in_app_count).toBe(delivered.in_app_count);
    expect(row.push_intent_count).toBe(delivered.push_intent_count);
  });

  it('two workers never process the same announcement at once', async () => {
    const id = await sendAnnouncement();
    const other = new AdminAnnouncementProcessor(dbHelper.db, new AdminAnnouncementRepository(dbHelper.db));
    await Promise.all([
      processor.processPendingAnnouncements({ batchSize: BATCH_SIZE }),
      other.processPendingAnnouncements({ batchSize: BATCH_SIZE }),
    ]);
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });

    expect(await recipientNumbers(id)).toEqual(eligibleNumbers());
    expect((await announcementRow(id)).status).toBe('SENT');
    expect((await announcementRow(id)).in_app_count).toBe(eligibleNumbers().length);
  });

  it('processes announcements in the order they were sent', async () => {
    const first = await sendAnnouncement({ audience: 'CITY', cityId: alexId });
    const second = await sendAnnouncement({ audience: 'CITY', cityId: cairoId });
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE, maxBatches: 1 });
    expect((await announcementRow(first)).status).toBe('SENDING');
    expect((await announcementRow(second)).status).toBe('PENDING');
    await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    expect((await announcementRow(first)).status).toBe('SENT');
    expect((await announcementRow(second)).status).toBe('SENT');
  });

  describe('push delivery of an announcement burst', () => {
    it('pushes the stored text in each device owner language with no post to open, and rechecks the preference at send time', async () => {
      const id = await sendAnnouncement();
      await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
      const intents = expectedIntents(eligibleNumbers());

      // One recipient turns push off after the fan-out queued their intent: suppressed at send time.
      const optOut = eligibleNumbers().find((i) => model.notificationsEnabled(i) && model.devices(i) === 1)!;
      await dbHelper.pool.query(`UPDATE users SET notifications_enabled = false WHERE id = $1`, [
        userIdByNumber.get(optOut)!,
      ]);

      const provider = new RecordingPushProvider();
      const push = new PushDeliveryProcessor(dbHelper.db, provider);
      let drains = 0;
      for (;;) {
        const { rows } = await dbHelper.pool.query<{ open: number }>(
          `SELECT count(*)::int AS open FROM push_deliveries WHERE status IN ('PENDING', 'PROCESSING')`,
        );
        if (rows[0].open === 0) break;
        await push.processPendingDeliveries();
        drains += 1;
        // A drain that hit the batch bound schedules a background follow-up; let it finish.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(provider.sent).toHaveLength(intents - 1);
      expect(drains).toBeGreaterThanOrEqual(Math.floor(intents / 50)); // 50 intents per invocation
      for (const message of provider.sent) {
        expect(Object.keys(message.data).sort()).toEqual(['notificationId', 'type']);
        expect(message.data.type).toBe('ADMIN_ANNOUNCEMENT');
      }
      const titles = new Set(provider.sent.map((message) => message.title));
      expect(titles).toEqual(new Set(['Vaccination week', 'أسبوع التطعيم']));

      const { rows: statuses } = await dbHelper.pool.query<{ status: string; count: number }>(
        `SELECT pd.status, count(*)::int AS count FROM push_deliveries pd
         JOIN notifications n ON n.id = pd.notification_id WHERE n.announcement_id = $1 GROUP BY pd.status`,
        [id],
      );
      expect(Object.fromEntries(statuses.map((row) => [row.status, row.count]))).toEqual({
        DELIVERED: intents - 1,
        SUPPRESSED: 1,
      });
      // The suppressed push never removes the in-app notification.
      expect(await recipientNumbers(id)).toContain(optOut);
    });
  });

  it('does nothing when no announcement is pending', async () => {
    const result = await processor.processPendingAnnouncements({ batchSize: BATCH_SIZE });
    expect(result).toMatchObject({ batchesProcessed: 0, notified: 0, failedBatches: 0 });
  });
});
