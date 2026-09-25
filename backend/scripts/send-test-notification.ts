/**
 * Sends one notification to an account in a LOCAL development database, through
 * the same path real activity uses: the inbox row and its push delivery intents
 * are written in one transaction, then the push worker delivers them over FCM.
 *
 * Use it to watch the whole notification experience on a phone or emulator
 * without needing a second account to comment, upvote or request contact:
 *   - the bell badge and the inbox entry,
 *   - a heads-up banner while the app is open,
 *   - a system notification while the app is in the background or closed,
 *   - tapping it opening the right Post (and comments for comment types).
 *
 * Usage:
 *   npm run notify:test -- --to you@example.com
 *   npm run notify:test -- --to you@example.com --type CONTACT_REQUEST_RECEIVED
 *   npm run notify:test -- --to you@example.com --post <postId>
 *   npm run notify:test -- --to you@example.com --inbox-only   # no push
 *   npm run notify:test -- --list-types
 *
 * The push goes out only when the account has a registered device (sign in on
 * the device and allow notifications first) and has notifications turned on in
 * Profile. The script prints what happened to every device's delivery.
 *
 * FCM is the real service: the backend's .env Firebase credentials must belong
 * to the same Firebase project the app is built with, and an Android emulator
 * must use a "Google Play" system image.
 */
import 'reflect-metadata';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { initializeApp, cert } from 'firebase-admin/app';
import * as schema from '../src/database/schema';
import { pushDeliveries } from '../src/database/schema';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { PushDeliveryRepository } from '../src/notifications/push-delivery.repository';
import { PushDeliveryProcessor } from '../src/notifications/push-delivery.processor';
import { FirebasePushProvider } from '../src/notifications/push.provider';
import { isPushDeliveryEnabled } from '../src/notifications/push-delivery.constants';
import { buildNotificationContent, type NotificationType } from '../src/notifications/notification-templates';

import * as dotenv from 'dotenv';
dotenv.config();

/** Types whose templates only need an actor name, a Post title or a target. */
const SUPPORTED_TYPES = [
  'NEW_COMMENT',
  'NEW_REPLY',
  'COMMENT_BOOSTED',
  'COMMENT_PINNED',
  'NEW_UPVOTE',
  'POST_SAVED',
  'CONTACT_REQUEST_RECEIVED',
  'CONTACT_REQUEST_APPROVED',
  'CONTACT_REQUEST_REJECTED',
  'ADOPTION_APPLICATION_RECEIVED',
  'ADOPTION_APPLICATION_APPROVED',
  'ADOPTION_APPLICATION_REJECTED',
  'POST_REOPENED_BY_ADMIN',
  'POST_INACTIVITY_NUDGE',
] as const satisfies readonly NotificationType[];
type SupportedType = (typeof SUPPORTED_TYPES)[number];

function parseArgs(argv: string[]) {
  let to: string | undefined;
  let type: SupportedType = 'NEW_COMMENT';
  let postId: string | undefined;
  let inboxOnly = false;
  let allowRemote = false;
  let listTypes = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--to') to = argv[++i]?.trim().toLowerCase();
    else if (arg === '--type') {
      const value = argv[++i]?.trim().toUpperCase();
      if (!SUPPORTED_TYPES.includes(value as SupportedType)) {
        throw new Error(`Unsupported --type ${value}. Supported: ${SUPPORTED_TYPES.join(', ')}`);
      }
      type = value as SupportedType;
    } else if (arg === '--post') postId = argv[++i]?.trim();
    else if (arg === '--inbox-only') inboxOnly = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--list-types') listTypes = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { to, type, postId, inboxOnly, allowRemote, listTypes };
}

/** Test notifications belong in a developer's database, never a shared or production one. */
function assertLocalDatabase(url: string | undefined, allowRemote: boolean) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !allowRemote) {
    throw new Error(
      `Refusing to send test notifications through a non-local database (${host}). Pass --allow-remote to override.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listTypes) {
    console.log(SUPPORTED_TYPES.join('\n'));
    return;
  }
  if (!args.to) throw new Error('Pass --to <email> — the account that should receive the notification.');
  assertLocalDatabase(process.env.DATABASE_URL, args.allowRemote);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const [recipient] = (
      await db.execute<{ id: string; full_name: string | null; notifications_enabled: boolean; devices: number }>(sql`
        SELECT u.id, u.full_name, u.notifications_enabled,
               (SELECT count(*)::int FROM device_registrations d WHERE d.user_id = u.id) AS devices
        FROM users u WHERE lower(u.email) = ${args.to}
      `)
    ).rows;
    if (!recipient) throw new Error(`No account with email ${args.to}`);

    // Route to the recipient's own newest active Post, the way real activity
    // (a comment, an upvote, a contact request) would.
    const [post] = (
      await db.execute<{ id: string; title: string }>(
        args.postId
          ? sql`SELECT id, title FROM posts WHERE id = ${args.postId}`
          : sql`SELECT id, title FROM posts
                WHERE creator_id = ${recipient.id} AND status = 'ACTIVE'
                ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows;
    if (!post) {
      throw new Error(
        args.postId
          ? `No Post ${args.postId}`
          : `${args.to} has no active Post to point the notification at — create one in the app or pass --post <id>.`,
      );
    }

    const content = buildNotificationContent(args.type, {
      actorName: 'Pupzy Test',
      postTitle: post.title,
      target: 'comment',
    } as never);

    const pushDeliveryRepository = new PushDeliveryRepository(db);
    const notificationsRepository = new NotificationsRepository(db, undefined, pushDeliveryRepository);
    const notification = await notificationsRepository.createIfNotIsolated(
      { recipientId: recipient.id, type: args.type, relatedPostId: post.id, ...content },
      undefined,
      { enqueuePush: !args.inboxOnly && isPushDeliveryEnabled(args.type) },
    );
    if (!notification) throw new Error('The notification was not created.');

    console.log(`✓ Inbox: "${content.title}" → ${args.to} (Post "${post.title}")`);
    if (args.inboxOnly) return;

    if (recipient.devices === 0) {
      console.log('ℹ No push sent: this account has no registered device.');
      console.log('  Sign in on the phone/emulator (against this backend) and allow notifications, then run again.');
      return;
    }
    if (!recipient.notifications_enabled) {
      console.log('ℹ Push will be suppressed: notifications are turned off in Profile for this account.');
    }

    const firebaseApp = initializeApp(
      {
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      },
      'send-test-notification',
    );
    const processor = new PushDeliveryProcessor(db, new FirebasePushProvider(firebaseApp));
    await processor.processPendingDeliveries();

    const deliveries = await db
      .select({ status: pushDeliveries.status, lastError: pushDeliveries.lastError })
      .from(pushDeliveries)
      .where(eq(pushDeliveries.notificationId, notification.id));
    for (const [index, delivery] of deliveries.entries()) {
      const detail = delivery.lastError ? ` — ${delivery.lastError}` : '';
      console.log(
        `${delivery.status === 'DELIVERED' ? '✓' : '✗'} Push to device ${index + 1}: ${delivery.status}${detail}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
