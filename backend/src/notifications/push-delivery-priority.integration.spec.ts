import { TestDatabaseHelper } from '../../test/test-database.helper';
import { PushDeliveryProcessor } from './push-delivery.processor';
import { PushDeliveryRepository } from './push-delivery.repository';
import type { PushDeliveryMessage, PushProvider } from './push.provider';
import { AdminAnnouncementRepository } from './admin-announcement.repository';
import { AdminAnnouncementProcessor } from './admin-announcement.processor';
import { PUSH_PRIORITY } from './push-delivery.constants';

/**
 * Push delivery order under an announcement burst. Time-sensitive pushes
 * (comments, adoption approvals, rescue updates) carry the default priority and
 * must be claimed before queued announcement intents, while announcements still
 * drain whenever nothing more urgent is due.
 */

const ANNOUNCEMENT_RECIPIENTS = 1_000;

class OrderRecordingProvider implements PushProvider {
  readonly sent: PushDeliveryMessage[] = [];
  send(message: PushDeliveryMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe('Push delivery priority (integration)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let provider: OrderRecordingProvider;
  let push: PushDeliveryProcessor;
  let commenterId: string;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  afterEach(async () => {
    // A full invocation schedules a background follow-up; let it finish before the next test.
    for (let guard = 0; guard < 400 && (push as unknown as { isProcessing: boolean }).isProcessing; guard++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    provider = new OrderRecordingProvider();
    push = new PushDeliveryProcessor(dbHelper.db, provider);

    await dbHelper.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, created_at)
       SELECT 'fb-' || g, 'u' || g || '@example.com', 'User ' || g, now() - interval '1 day'
       FROM generate_series(1, $1::int) g`,
      [ANNOUNCEMENT_RECIPIENTS],
    );
    await dbHelper.pool.query(
      `INSERT INTO device_registrations (user_id, token, platform)
       SELECT id, 'token-' || firebase_user_id, 'ANDROID' FROM users`,
    );
    const admin = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, full_name, role)
       VALUES ('super@example.com', 'x', 'Super Admin', 'SUPER_ADMIN') RETURNING id`,
    );
    await dbHelper.pool.query(
      `INSERT INTO announcements (request_key, sent_by_admin_id, audience, title_en, body_en, title_ar, body_ar,
                                  expected_recipients)
       VALUES (uuidv7(), $1, 'ALL', 'Vaccination week', 'Free shots.', 'أسبوع التطعيم', 'تطعيم مجاني.', $2)
       RETURNING id`,
      [admin.rows[0].id, ANNOUNCEMENT_RECIPIENTS],
    );
    const processor = new AdminAnnouncementProcessor(dbHelper.db, new AdminAnnouncementRepository(dbHelper.db));
    await processor.processPendingAnnouncements();

    const commenter = await dbHelper.pool.query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
    commenterId = commenter.rows[0].id;
  });

  /** A comment notification and its intent, created after the announcement burst is queued. */
  async function queueCommentIntent(): Promise<string> {
    const { rows } = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO notifications (recipient_id, type, title, body)
       VALUES ($1, 'NEW_COMMENT', 'New comment', 'Someone commented on your post') RETURNING id`,
      [commenterId],
    );
    await new PushDeliveryRepository(dbHelper.db).enqueueForNotification(
      { id: rows[0].id, recipientId: commenterId },
      null,
    );
    return rows[0].id;
  }

  async function pendingIntents(): Promise<number> {
    const { rows } = await dbHelper.pool.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM push_deliveries WHERE status IN ('PENDING', 'PROCESSING')`,
    );
    return rows[0].open;
  }

  it('gives announcement intents the bulk priority and every other intent the default', async () => {
    const commentNotificationId = await queueCommentIntent();
    const { rows } = await dbHelper.pool.query<{ type: string; priority: number; intents: number }>(
      `SELECT n.type::text AS type, pd.priority, count(*)::int AS intents
       FROM push_deliveries pd JOIN notifications n ON n.id = pd.notification_id
       GROUP BY n.type, pd.priority ORDER BY n.type`,
    );
    expect(rows).toEqual([
      { type: 'NEW_COMMENT', priority: PUSH_PRIORITY.DEFAULT, intents: 1 },
      { type: 'ADMIN_ANNOUNCEMENT', priority: PUSH_PRIORITY.BULK, intents: ANNOUNCEMENT_RECIPIENTS },
    ]);
    expect(PUSH_PRIORITY.DEFAULT).toBeLessThan(PUSH_PRIORITY.BULK);
    expect(commentNotificationId).toBeTruthy();
  });

  it('claims a comment intent before 1,000 queued announcement intents, then the announcements keep draining', async () => {
    expect(await pendingIntents()).toBe(ANNOUNCEMENT_RECIPIENTS);
    await queueCommentIntent();
    expect(await pendingIntents()).toBe(ANNOUNCEMENT_RECIPIENTS + 1);

    // One invocation claims 50 intents in order.
    await push.processPendingDeliveries();
    expect(provider.sent[0].title).toBe('New comment');
    expect(provider.sent[0].data.type).toBe('NEW_COMMENT');
    expect(provider.sent.slice(1).every((message) => message.data.type === 'ADMIN_ANNOUNCEMENT')).toBe(true);
    expect(provider.sent.length).toBeGreaterThan(1);

    // Announcements continue: nothing more urgent is due, so nothing starves.
    for (let guard = 0; guard < 2_400 && (await pendingIntents()) > 0; guard++) {
      await push.processPendingDeliveries();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await pendingIntents()).toBe(0);
    expect(provider.sent).toHaveLength(ANNOUNCEMENT_RECIPIENTS + 1);
    const { rows } = await dbHelper.pool.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM push_deliveries GROUP BY status`,
    );
    expect(rows).toEqual([{ status: 'DELIVERED', count: ANNOUNCEMENT_RECIPIENTS + 1 }]);
  });

  it('keeps the existing order inside a priority: due time first, then creation', async () => {
    const first = await queueCommentIntent();
    const second = await queueCommentIntent();
    await dbHelper.pool.query(
      `UPDATE push_deliveries SET next_attempt_at = now() - interval '1 hour' WHERE notification_id = $1`,
      [second],
    );
    await push.processPendingDeliveries();
    const { rows } = await dbHelper.pool.query<{ notification_id: string }>(
      `SELECT notification_id FROM push_deliveries WHERE status = 'DELIVERED' AND priority = 0
       ORDER BY delivered_at ASC, id ASC`,
    );
    expect(rows.map((row) => row.notification_id)).toEqual([second, first]);
  });
});
