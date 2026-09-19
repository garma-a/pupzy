import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  buildBanUserAction,
  buildUnbanUserAction,
  runUserBanPostCascade,
} from '../src/adminjs/actions/ban-user.action.js';
import { buildPostActions } from '../src/adminjs/actions/moderate-post.actions.js';
import { buildCommentActions } from '../src/adminjs/actions/moderate-comment.actions.js';
import {
  buildAccountReportReviewAction,
  buildPostReportReviewAction,
} from '../src/adminjs/actions/review-report.actions.js';
import { computeStats } from '../src/adminjs/dashboard/dashboard-cache.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

const database = new TestDatabaseHelper();
let principals;
let userSequence = 0;

async function insertUser(label) {
  userSequence += 1;
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`fb-${label}-${userSequence}`, `${label}-${userSequence}@example.com`, `User ${label} ${userSequence}`],
  );
  return rows[0].id;
}

async function insertPostReport({ postId, reporterId, reason = 'SPAM', details = null }) {
  const { rows } = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [postId, reporterId, reason, details],
  );
  return rows[0].id;
}

async function insertAccountReport({ reporterId, reportedUserId, reason = 'SPAM', details = null }) {
  const { rows } = await database.pool.query(
    `INSERT INTO account_reports (reporter_id, reported_user_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [reporterId, reportedUserId, reason, details],
  );
  return rows[0].id;
}

async function insertCommentReport({ commentId, reporterId, reason = 'SPAM', details = null }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comment_reports (comment_id, reporter_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [commentId, reporterId, reason, details],
  );
  return rows[0].id;
}

async function markReportReviewed(table, reportId, adminId, outcome) {
  await database.pool.query(
    `UPDATE ${table}
     SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = $3
     WHERE id = $1`,
    [reportId, adminId, outcome],
  );
}

async function withFailureTrigger({ table, event, suffix }, run) {
  const functionName = `ticket04_forced_failure_${suffix}`;
  const triggerName = `ticket04_forced_failure_trigger_${suffix}`;
  await database.pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'forced ${suffix} failure';
    END;
    $fn$;
    CREATE TRIGGER ${triggerName} BEFORE ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `);
  try {
    await run();
  } finally {
    await database.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
    await database.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
}

function context(id, adminId) {
  return {
    record: { id: () => id, toJSON: () => ({ id, params: {} }) },
    currentAdmin: {
      id: adminId,
      role: 'SUPER_ADMIN',
      email: 'admin@example.com',
    },
  };
}

async function call(action, id, payload = {}) {
  return action.handler({ method: 'post', payload }, null, context(id, principals.adminId));
}

before(async () => database.start());
beforeEach(async () => {
  await database.clean();
  userSequence = 0;
  principals = await seedPrincipals(database.pool);
});
after(async () => database.stop());

describe('moderation actions', () => {
  it('bans a user and writes exactly one audit row', async () => {
    const response = await call(buildBanUserAction(database.pool, 'ModerationAction'), principals.userId, {
      reason: 'Repeated scams',
    });
    assert.equal(response.notice.type, 'success');
    const user = await database.pool.query('SELECT is_banned, ban_reason FROM users WHERE id = $1', [
      principals.userId,
    ]);
    assert.equal(user.rows[0].is_banned, true);
    assert.equal(user.rows[0].ban_reason, 'Repeated scams');
    const audit = await database.pool.query(`SELECT action_type FROM moderation_actions WHERE target_id = $1`, [
      principals.userId,
    ]);
    assert.deepEqual(
      audit.rows.map((row) => row.action_type),
      ['USER_BANNED'],
    );
  });

  it('uses the active creator UUID keyset index for a late durable ban-cascade page', async () => {
    const otherCreator = (
      await database.pool.query(
        `INSERT INTO users (firebase_user_id, email, full_name)
         VALUES ('ticket11-plan-other-creator', 'ticket11-plan-other@example.com', 'Plan Other Creator')
         RETURNING id`,
      )
    ).rows[0];

    await database.pool.query(
      `INSERT INTO public.posts
         (creator_id, post_type, title, description, status, moderation_status, city_id,
          coordinates, report_count, urgency)
       SELECT CASE WHEN series % 24 = 0 THEN $1::uuid ELSE $2::uuid END,
              'ADOPTION', 'Ticket 11 keyset plan ' || series, 'Description', 'ACTIVE',
              'PENDING_AUTO_REVIEW', $3,
              ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 0, NULL
       FROM generate_series(1, 24000) AS series`,
      [principals.userId, otherCreator.id, principals.cityId],
    );

    const { rows: cursorRows } = await database.pool.query(
      `SELECT id
       FROM public.posts
       WHERE creator_id = $1 AND status = 'ACTIVE'
       ORDER BY id ASC
       OFFSET 800
       LIMIT 1`,
      [principals.userId],
    );
    assert.equal(cursorRows.length, 1);
    await database.pool.query('VACUUM (ANALYZE) public.posts');

    const { rows: explainRows } = await database.pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id
       FROM public.posts
       WHERE creator_id = $1
         AND status = 'ACTIVE'
         AND ($2::uuid IS NULL OR id > $2::uuid)
       ORDER BY id ASC
       LIMIT 100`,
      [principals.userId, cursorRows[0].id],
    );
    const plan = explainRows[0]['QUERY PLAN'][0].Plan;
    const planJson = JSON.stringify(plan);
    const walkPlan = (node, collected = []) => {
      collected.push(node);
      for (const child of node.Plans ?? []) walkPlan(child, collected);
      return collected;
    };
    const keysetIndexScan = walkPlan(plan).find(
      (node) =>
        ['Index Scan', 'Index Only Scan'].includes(node['Node Type']) &&
        node['Index Name'] === 'idx_posts_active_creator_id_id',
    );

    assert.equal(plan['Node Type'], 'Limit');
    assert.equal(Number(plan['Actual Rows']), 100);
    assert.ok(keysetIndexScan, 'late keyset page must directly scan the ACTIVE creator/id partial index');
    assert.match(keysetIndexScan['Index Cond'], /creator_id/);
    assert.match(keysetIndexScan['Index Cond'], /id >/);
    assert.equal(Number(keysetIndexScan['Actual Rows']), 100);
    assert.doesNotMatch(planJson, /"Node Type":"(?:Seq Scan|Bitmap Heap Scan|Sort)"/);
  });

  it('keeps the banned-creator database boundary safe with a prepended shadow schema', async () => {
    await database.pool.query(
      `UPDATE public.users
       SET is_banned = true, banned_at = now(), ban_reason = 'Ticket 11 search path regression'
       WHERE id = $1`,
      [principals.userId],
    );
    const { rows: bindings } = await database.pool.query(
      `SELECT function_namespace.nspname AS function_schema, function_proc.proname, function_proc.proconfig
       FROM pg_trigger AS trigger_binding
       JOIN pg_class AS relation ON relation.oid = trigger_binding.tgrelid
       JOIN pg_proc AS function_proc ON function_proc.oid = trigger_binding.tgfoid
       JOIN pg_namespace AS function_namespace ON function_namespace.oid = function_proc.pronamespace
       WHERE trigger_binding.tgname = 'trg_prevent_banned_creator_active_post'
         AND relation.oid = 'public.posts'::regclass`,
    );
    assert.deepEqual(bindings, [
      {
        function_schema: 'public',
        proname: 'prevent_banned_creator_active_post',
        proconfig: ['search_path=pg_catalog, public'],
      },
    ]);

    await database.pool.query('CREATE SCHEMA ticket11_shadow');
    const client = await database.pool.connect();
    try {
      await database.pool.query(
        `CREATE TABLE ticket11_shadow.users (
           id uuid PRIMARY KEY,
           is_banned boolean NOT NULL
         )`,
      );
      await database.pool.query('INSERT INTO ticket11_shadow.users (id, is_banned) VALUES ($1, false)', [
        principals.userId,
      ]);

      await client.query('BEGIN');
      await client.query('SET LOCAL search_path = ticket11_shadow, public, pg_catalog');
      const { rows: sessionRows } = await client.query(
        `SELECT current_schema() AS current_schema, current_setting('search_path') AS configured_path`,
      );
      assert.equal(sessionRows[0].current_schema, 'ticket11_shadow');
      assert.equal(sessionRows[0].configured_path, 'ticket11_shadow, public, pg_catalog');

      await assert.rejects(
        client.query(
          `INSERT INTO public.posts
             (creator_id, post_type, title, description, status, moderation_status, city_id,
              coordinates, report_count, urgency)
           VALUES ($1, 'ADOPTION', 'Shadow schema ban boundary', 'Description', 'ACTIVE',
                   'PENDING_AUTO_REVIEW', $2,
                   ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 0, NULL)`,
          [principals.userId, principals.cityId],
        ),
        (error) => {
          assert.equal(error.code, '23514');
          assert.equal(error.message, 'ACTIVE_POST_CREATOR_BANNED');
          return true;
        },
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      await database.pool.query('DROP SCHEMA IF EXISTS ticket11_shadow CASCADE');
    }

    const persisted = await database.pool.query(
      `SELECT count(*)::int AS count
       FROM public.posts
       WHERE creator_id = $1 AND title = 'Shadow schema ban boundary'`,
      [principals.userId],
    );
    assert.equal(persisted.rows[0].count, 0);
  });

  it('serializes concurrent bans so only one succeeds', async () => {
    const action = buildBanUserAction(database.pool, 'ModerationAction');
    const responses = await Promise.all([
      call(action, principals.userId, { reason: 'Abuse' }),
      call(action, principals.userId, { reason: 'Abuse' }),
    ]);
    assert.deepEqual(responses.map((item) => item.notice.type).sort(), ['error', 'success']);
    const audit = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'USER_BANNED'`,
      [principals.userId],
    );
    assert.equal(audit.rows[0].count, 1);
  });

  it('rejects an empty ban reason without database writes', async () => {
    const response = await call(buildBanUserAction(database.pool, 'ModerationAction'), principals.userId, {
      reason: '   ',
    });
    assert.equal(response.notice.type, 'error');
    const state = await database.pool.query(
      `SELECT is_banned, (SELECT count(*)::int FROM moderation_actions) AS audit_count
       FROM users WHERE id = $1`,
      [principals.userId],
    );
    assert.equal(state.rows[0].is_banned, false);
    assert.equal(state.rows[0].audit_count, 0);
  });

  it('durably pages a user ban cascade and emits one notification after completion', async () => {
    for (let index = 0; index < 101; index += 1) {
      await insertPost(database.pool, {
        ...principals,
        title: `Active ${index}`,
      });
    }
    await insertPost(database.pool, {
      ...principals,
      title: 'Already removed',
      status: 'REMOVED',
    });

    const reporterId = await insertUser('cascade-reporter');
    const reportedPosts = await database.pool.query(
      `SELECT id FROM posts WHERE creator_id = $1 AND status = 'ACTIVE' ORDER BY id LIMIT 2`,
      [principals.userId],
    );
    const firstReport = await insertPostReport({ postId: reportedPosts.rows[0].id, reporterId });
    const secondReport = await insertPostReport({ postId: reportedPosts.rows[1].id, reporterId });

    const response = await call(buildBanUserAction(database.pool, 'ModerationAction'), principals.userId, {
      reason: 'Coordinated spam',
      alsoRemovePosts: true,
    });
    assert.equal(response.notice.type, 'success');
    const [pending] = (
      await database.pool.query(
        `SELECT action_id, state, cascaded_post_count FROM user_ban_post_cascades WHERE user_id = $1`,
        [principals.userId],
      )
    ).rows;
    assert.equal(pending.state, 'PENDING');
    assert.equal(Number(pending.cascaded_post_count), 100);
    const activeDuringRecovery = await database.pool.query(
      `SELECT count(*)::int AS count FROM posts WHERE creator_id = $1 AND status = 'ACTIVE'`,
      [principals.userId],
    );
    assert.equal(Number(activeDuringRecovery.rows[0].count), 1);

    await runUserBanPostCascade(database.pool, pending.action_id);
    const posts = await database.pool.query(`SELECT title, status FROM posts ORDER BY title`);
    assert.equal(posts.rows.filter((row) => row.status === 'REMOVED').length, 102);
    const notifications = await database.pool.query(`SELECT type FROM notifications`);
    assert.deepEqual(
      notifications.rows.map((row) => row.type),
      ['POST_REMOVED_BY_ADMIN'],
    );
    const audit = await database.pool.query(`SELECT metadata FROM moderation_actions`);
    assert.equal(audit.rows[0].metadata.cascadedPostCount, 101);
    assert.equal(audit.rows[0].metadata.postCascade.state, 'COMPLETED');

    // Cascade-removed Posts close their open Post Reports in the same batch
    // transaction and correlate the ids into the ban audit metadata.
    const closedReports = await database.pool.query(
      `SELECT id, reviewed_at, reviewed_by_admin_id, review_outcome
       FROM post_reports
       WHERE id = ANY($1::uuid[])`,
      [[firstReport, secondReport]],
    );
    assert.equal(closedReports.rows.length, 2);
    for (const row of closedReports.rows) {
      assert.ok(row.reviewed_at);
      assert.equal(row.reviewed_by_admin_id, principals.adminId);
      assert.equal(row.review_outcome, 'ACTION_TAKEN');
    }
    assert.deepEqual([...audit.rows[0].metadata.closedPostReportIds].sort(), [firstReport, secondReport].sort());
  });

  it('serializes an in-flight Post creation with ban paging and releases the first page locks before the next page', async () => {
    for (let index = 0; index < 100; index += 1) {
      await insertPost(database.pool, { ...principals, title: `Existing cascade Post ${index}` });
    }

    const creator = await database.pool.connect();
    const blocker = await database.pool.connect();
    const barrierClass = 71_112;
    const barrierObject = 20_263;
    let creatorOpen = false;
    let barrierReleased = false;
    let triggerInstalled = false;

    const waitFor = async (predicate, description) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(description);
    };

    try {
      await creator.query('BEGIN');
      creatorOpen = true;
      await creator.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [principals.userId]);
      const ban = call(buildBanUserAction(database.pool, 'ModerationAction'), principals.userId, {
        reason: 'Concurrent creation evidence',
        alsoRemovePosts: true,
      });
      await waitFor(async () => {
        const { rows } = await database.pool.query(
          `SELECT count(*)::int AS count
             FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
               AND query LIKE '%FROM users WHERE id = $1 FOR UPDATE%'`,
        );
        return Number(rows[0].count) >= 1;
      }, 'ban action did not block on the in-flight Post creator user lock');

      const inserted = await creator.query(
        `INSERT INTO posts
           (creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, report_count, urgency)
         VALUES ($1, 'ADOPTION', 'Post committed immediately before ban', 'Description', 'ACTIVE',
                 'PENDING_AUTO_REVIEW', $2, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 0, NULL)
         RETURNING id`,
        [principals.userId, principals.cityId],
      );
      const inFlightPostId = inserted.rows[0].id;
      await creator.query('COMMIT');
      creatorOpen = false;

      const response = await ban;
      assert.equal(response.notice.type, 'success');
      const active = await database.pool.query(
        `SELECT id FROM posts WHERE creator_id = $1 AND status = 'ACTIVE' ORDER BY id ASC`,
        [principals.userId],
      );
      assert.equal(active.rows.length, 1);
      assert.equal(active.rows[0].id, inFlightPostId);

      const { rows: cascadeRows } = await database.pool.query(
        `SELECT action_id FROM user_ban_post_cascades WHERE user_id = $1`,
        [principals.userId],
      );
      const actionId = cascadeRows[0].action_id;
      const { rows: pageRows } = await database.pool.query(
        `SELECT id FROM posts WHERE creator_id = $1 ORDER BY id ASC`,
        [principals.userId],
      );
      const firstPagePostId = pageRows[0].id;
      const secondPagePostId = pageRows[100].id;
      assert.equal(secondPagePostId, inFlightPostId);

      await blocker.query('SELECT pg_advisory_lock($1, $2)', [barrierClass, barrierObject]);
      await database.pool.query(
        `CREATE FUNCTION ticket11_ban_page_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.id = '${secondPagePostId}'::uuid THEN
             PERFORM pg_advisory_xact_lock(${barrierClass}, ${barrierObject});
           END IF;
           RETURN NEW;
         END;
         $$;
         CREATE TRIGGER ticket11_ban_page_barrier_trigger
           BEFORE UPDATE OF status ON posts FOR EACH ROW EXECUTE FUNCTION ticket11_ban_page_barrier();`,
      );
      triggerInstalled = true;

      const recovery = runUserBanPostCascade(database.pool, actionId, { maxBatches: 1 });
      await waitFor(async () => {
        const { rows } = await database.pool.query(
          `SELECT count(*)::int AS count FROM pg_locks
             WHERE locktype = 'advisory' AND NOT granted AND classid = $1 AND objid = $2`,
          [barrierClass, barrierObject],
        );
        return Number(rows[0].count) === 1;
      }, 'second cascade page did not reach the database barrier');

      const probe = await database.pool.connect();
      try {
        const acquired = await probe.query(
          `SELECT pg_try_advisory_lock(hashtextextended('comment_discussion:' || $1, 0)) AS acquired`,
          [firstPagePostId],
        );
        assert.equal(acquired.rows[0].acquired, true, 'first-page discussion lock must be released before page two');
        await probe.query(`SELECT pg_advisory_unlock(hashtextextended('comment_discussion:' || $1, 0))`, [
          firstPagePostId,
        ]);
      } finally {
        probe.release();
      }

      await blocker.query('SELECT pg_advisory_unlock($1, $2)', [barrierClass, barrierObject]);
      barrierReleased = true;
      await recovery;
      await runUserBanPostCascade(database.pool, actionId);

      const finalPost = await database.pool.query('SELECT status FROM posts WHERE id = $1', [inFlightPostId]);
      assert.equal(finalPost.rows[0].status, 'REMOVED');
      const finalCascade = await database.pool.query(
        `SELECT state, cascaded_post_count FROM user_ban_post_cascades WHERE action_id = $1`,
        [actionId],
      );
      assert.equal(finalCascade.rows[0].state, 'COMPLETED');
      assert.equal(Number(finalCascade.rows[0].cascaded_post_count), 101);
      await assert.rejects(
        insertPost(database.pool, { ...principals, title: 'Post after committed ban' }),
        (error) => error?.code === '23514' && /ACTIVE_POST_CREATOR_BANNED/.test(error.message),
      );
    } finally {
      if (!barrierReleased) {
        await blocker.query('SELECT pg_advisory_unlock($1, $2)', [barrierClass, barrierObject]).catch(() => {});
      }
      if (triggerInstalled) {
        await database.pool.query('DROP TRIGGER IF EXISTS ticket11_ban_page_barrier_trigger ON posts');
        await database.pool.query('DROP FUNCTION IF EXISTS ticket11_ban_page_barrier()');
      }
      if (creatorOpen) await creator.query('ROLLBACK').catch(() => {});
      creator.release();
      blocker.release();
    }
  });

  it('does not send an empty removal notification when the banned user has no posts', async () => {
    const response = await call(buildBanUserAction(database.pool, 'ModerationAction'), principals.userId, {
      reason: 'Harassment',
      alsoRemovePosts: true,
    });
    assert.equal(response.notice.type, 'success');
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
  });

  it('rejects unbanning an already-unbanned user', async () => {
    const response = await call(buildUnbanUserAction(database.pool), principals.userId);
    assert.equal(response.notice.type, 'error');
    assert.match(response.notice.message, /not banned/i);
    const audit = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audit.rows[0].count, 0);
  });

  it('enforces all post state-machine transitions under the row lock', async () => {
    const postId = await insertPost(database.pool, principals);
    const actions = buildPostActions(database.pool, 'ModerationAction');

    assert.equal((await call(actions.approvePost, postId)).notice.type, 'success');
    assert.equal((await call(actions.approvePost, postId)).notice.type, 'error');
    assert.equal((await call(actions.flagPost, postId, { reason: 'Suspicious' })).notice.type, 'success');
    assert.equal((await call(actions.flagPost, postId, { reason: 'Again' })).notice.type, 'error');
    assert.equal((await call(actions.removePost, postId, { reason: 'Policy violation' })).notice.type, 'success');
    assert.equal((await call(actions.removePost, postId, { reason: 'Again' })).notice.type, 'error');
    assert.equal((await call(actions.restorePost, postId)).notice.type, 'success');
    assert.equal((await call(actions.restorePost, postId)).notice.type, 'error');

    const audits = await database.pool.query(
      `SELECT action_type FROM moderation_actions WHERE target_id = $1 ORDER BY created_at`,
      [postId],
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action_type),
      ['POST_APPROVED', 'POST_FLAGGED', 'POST_REMOVED', 'POST_RESTORED'],
    );
  });

  it('removePost inserts one correctly linked notification', async () => {
    const postId = await insertPost(database.pool, principals);
    await call(buildPostActions(database.pool, 'ModerationAction').removePost, postId, { reason: 'Spam' });
    const notifications = await database.pool.query(
      `SELECT type, related_post_id FROM notifications WHERE recipient_id = $1`,
      [principals.userId],
    );
    assert.equal(notifications.rows.length, 1);
    assert.equal(notifications.rows[0].type, 'POST_REMOVED_BY_ADMIN');
    assert.equal(notifications.rows[0].related_post_id, postId);
  });

  it('stores SQL injection text literally without executing it', async () => {
    const postId = await insertPost(database.pool, principals);
    const reason = "x'; DROP TABLE posts; --";
    await call(buildPostActions(database.pool, 'ModerationAction').flagPost, postId, { reason });
    const result = await database.pool.query(`SELECT moderation_reason FROM posts WHERE id = $1`, [postId]);
    assert.equal(result.rows[0].moderation_reason, reason);
    assert.equal((await database.pool.query(`SELECT count(*)::int AS count FROM posts`)).rows[0].count, 1);
  });

  it('round-trips XSS-shaped moderation text without storage-layer mangling', async () => {
    const postId = await insertPost(database.pool, principals);
    const reason = '<script>alert(1)</script>';
    await call(buildPostActions(database.pool, 'ModerationAction').flagPost, postId, { reason });
    const result = await database.pool.query(`SELECT moderation_reason FROM posts WHERE id = $1`, [postId]);
    assert.equal(result.rows[0].moderation_reason, reason);
  });

  it('restoring a post preserves previous moderation status and exposes the correct actions', async () => {
    const actions = buildPostActions(database.pool, 'ModerationAction');

    // Case 1: Clean post -> remove -> restore -> still clean
    const cleanPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'CLEAN',
    });
    await call(actions.removePost, cleanPostId, { reason: 'Temporary takedown' });
    const removedCleanRow = (
      await database.pool.query(`SELECT status, moderation_status FROM posts WHERE id = $1`, [cleanPostId])
    ).rows[0];
    assert.equal(removedCleanRow.status, 'REMOVED');
    assert.equal(removedCleanRow.moderation_status, 'CLEAN');

    // While removed: only restorePost is visible
    const removedCleanRecord = { params: removedCleanRow };
    assert.equal(actions.restorePost.isVisible({ record: removedCleanRecord }), true);
    assert.equal(actions.approvePost.isVisible({ record: removedCleanRecord }), false);
    assert.equal(actions.flagPost.isVisible({ record: removedCleanRecord }), false);
    assert.equal(actions.removePost.isVisible({ record: removedCleanRecord }), false);

    // Restore
    const restoreCleanRes = await call(actions.restorePost, cleanPostId);
    assert.equal(restoreCleanRes.notice.type, 'success');
    const restoredCleanRow = (
      await database.pool.query(`SELECT status, moderation_status FROM posts WHERE id = $1`, [cleanPostId])
    ).rows[0];
    assert.equal(restoredCleanRow.status, 'ACTIVE');
    assert.equal(restoredCleanRow.moderation_status, 'CLEAN');

    // After restoring clean post: shows flagPost and removePost, not approvePost or restorePost
    const restoredCleanRecord = { params: restoredCleanRow };
    assert.equal(actions.flagPost.isVisible({ record: restoredCleanRecord }), true);
    assert.equal(actions.removePost.isVisible({ record: restoredCleanRecord }), true);
    assert.equal(actions.approvePost.isVisible({ record: restoredCleanRecord }), false);
    assert.equal(actions.restorePost.isVisible({ record: restoredCleanRecord }), false);

    // Case 2: Flagged post -> remove -> restore -> still flagged
    const flaggedPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'FLAGGED',
    });
    await call(actions.removePost, flaggedPostId, { reason: 'Policy takedown' });
    await call(actions.restorePost, flaggedPostId);
    const restoredFlaggedRow = (
      await database.pool.query(`SELECT status, moderation_status FROM posts WHERE id = $1`, [flaggedPostId])
    ).rows[0];
    assert.equal(restoredFlaggedRow.status, 'ACTIVE');
    assert.equal(restoredFlaggedRow.moderation_status, 'FLAGGED');

    // After restoring flagged post: shows approvePost and removePost, not flagPost or restorePost
    const restoredFlaggedRecord = { params: restoredFlaggedRow };
    assert.equal(actions.approvePost.isVisible({ record: restoredFlaggedRecord }), true);
    assert.equal(actions.removePost.isVisible({ record: restoredFlaggedRecord }), true);
    assert.equal(actions.flagPost.isVisible({ record: restoredFlaggedRecord }), false);
    assert.equal(actions.restorePost.isVisible({ record: restoredFlaggedRecord }), false);

    // Case 3: Pending post -> remove -> restore -> still pending
    const pendingPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
    });
    await call(actions.removePost, pendingPostId, { reason: 'Pending takedown' });
    await call(actions.restorePost, pendingPostId);
    const restoredPendingRow = (
      await database.pool.query(`SELECT status, moderation_status FROM posts WHERE id = $1`, [pendingPostId])
    ).rows[0];
    assert.equal(restoredPendingRow.status, 'ACTIVE');
    assert.equal(restoredPendingRow.moderation_status, 'PENDING_AUTO_REVIEW');

    // After restoring pending post: shows approvePost, flagPost, and removePost, not restorePost
    const restoredPendingRecord = { params: restoredPendingRow };
    assert.equal(actions.approvePost.isVisible({ record: restoredPendingRecord }), true);
    assert.equal(actions.flagPost.isVisible({ record: restoredPendingRecord }), true);
    assert.equal(actions.removePost.isVisible({ record: restoredPendingRecord }), true);
    assert.equal(actions.restorePost.isVisible({ record: restoredPendingRecord }), false);
  });

  it('rejects direct action attempts on removed or invalid post states under row lock', async () => {
    const actions = buildPostActions(database.pool, 'ModerationAction');
    const postId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'FLAGGED',
      status: 'REMOVED',
    });

    // Attempting to approve a removed post fails
    const approveRes = await call(actions.approvePost, postId);
    assert.equal(approveRes.notice.type, 'error');
    assert.match(approveRes.notice.message, /only active/i);

    // Attempting to flag a removed post fails
    const flagRes = await call(actions.flagPost, postId, { reason: 'Spam' });
    assert.equal(flagRes.notice.type, 'error');
    assert.match(flagRes.notice.message, /only active/i);

    // Attempting to remove an already removed post fails
    const removeRes = await call(actions.removePost, postId, { reason: 'Spam' });
    assert.equal(removeRes.notice.type, 'error');
    assert.match(removeRes.notice.message, /only active/i);

    // Zero audits written from these failed attempts
    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions WHERE target_id = $1`,
      [postId],
    );
    assert.equal(audits.rows[0].count, 0);
  });

  it('serializes concurrent competing transitions on posts under row lock', async () => {
    const actions = buildPostActions(database.pool, 'ModerationAction');
    const postId = await insertPost(database.pool, principals);

    // Concurrent remove requests
    const responses = await Promise.all([
      call(actions.removePost, postId, { reason: 'Reason 1' }),
      call(actions.removePost, postId, { reason: 'Reason 2' }),
    ]);
    assert.deepEqual(responses.map((item) => item.notice.type).sort(), ['error', 'success']);

    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'POST_REMOVED'`,
      [postId],
    );
    assert.equal(audits.rows[0].count, 1);
  });
});

describe('audited report outcomes', () => {
  it('reviews a Post Report with no action and appends one correlated audit entry', async () => {
    const authorId = await insertUser('post-author');
    const postId = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'No-action review post',
      moderationStatus: 'FLAGGED',
    });
    const reportId = await insertPostReport({
      postId,
      reporterId: principals.userId,
      details: 'Misleading rescue details',
    });

    const action = buildPostReportReviewAction(database.pool, 'ModerationAction');
    const first = await call(action, reportId, {});
    assert.equal(first.notice.type, 'success');

    const report = (await database.pool.query(`SELECT * FROM post_reports WHERE id = $1`, [reportId])).rows[0];
    assert.ok(report.reviewed_at, 'the report must be closed');
    assert.equal(report.reviewed_by_admin_id, principals.adminId);
    assert.equal(report.review_outcome, 'NO_ACTION');

    const audits = (await database.pool.query(`SELECT * FROM moderation_actions WHERE target_id = $1`, [postId])).rows;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action_type, 'POST_REPORT_REVIEWED_NO_ACTION');
    assert.equal(audits[0].target_type, 'POST');
    assert.equal(audits[0].admin_user_id, principals.adminId);
    assert.equal(audits[0].reason, null);
    assert.equal(audits[0].metadata.reportId, reportId);
    assert.equal(audits[0].metadata.reviewOutcome, 'NO_ACTION');

    const post = (await database.pool.query(`SELECT status, moderation_status FROM posts WHERE id = $1`, [postId]))
      .rows[0];
    assert.equal(post.status, 'ACTIVE');
    assert.equal(post.moderation_status, 'FLAGGED');

    const retry = await call(action, reportId, { reason: 'Second attempt' });
    assert.equal(retry.notice.type, 'error');
    assert.match(retry.notice.message, /already been reviewed/i);
    const auditCount = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions WHERE target_id = $1`,
      [postId],
    );
    assert.equal(auditCount.rows[0].count, 1);
  });

  it('reviews a Pupzy Account Report with no action and permits a later report', async () => {
    const reportedId = await insertUser('reported-account');
    const reportId = await insertAccountReport({
      reporterId: principals.userId,
      reportedUserId: reportedId,
      reason: 'HARASSMENT',
      details: 'Repeated unwanted contact',
    });

    const action = buildAccountReportReviewAction(database.pool, 'ModerationAction');
    const response = await call(action, reportId, { reason: 'Unsubstantiated after review' });
    assert.equal(response.notice.type, 'success');

    const report = (await database.pool.query(`SELECT * FROM account_reports WHERE id = $1`, [reportId])).rows[0];
    assert.ok(report.reviewed_at);
    assert.equal(report.reviewed_by_admin_id, principals.adminId);
    assert.equal(report.review_outcome, 'NO_ACTION');

    const audits = (await database.pool.query(`SELECT * FROM moderation_actions WHERE target_id = $1`, [reportedId]))
      .rows;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action_type, 'ACCOUNT_REPORT_REVIEWED_NO_ACTION');
    assert.equal(audits[0].target_type, 'USER');
    assert.equal(audits[0].admin_user_id, principals.adminId);
    assert.equal(audits[0].reason, 'Unsubstantiated after review');
    assert.equal(audits[0].metadata.reportId, reportId);
    assert.equal(audits[0].metadata.reviewOutcome, 'NO_ACTION');

    const freshReportId = await insertAccountReport({
      reporterId: principals.userId,
      reportedUserId: reportedId,
      reason: 'SPAM',
    });
    const openReports = await database.pool.query(
      `SELECT count(*)::int AS count FROM account_reports
       WHERE reporter_id = $1 AND reported_user_id = $2 AND reviewed_at IS NULL`,
      [principals.userId, reportedId],
    );
    assert.equal(openReports.rows[0].count, 1);
    assert.notEqual(freshReportId, reportId);
  });

  it('serializes concurrent no-action reviews to one closure and one audit entry', async () => {
    const reportedId = await insertUser('raced-account');
    const reportId = await insertAccountReport({ reporterId: principals.userId, reportedUserId: reportedId });
    const action = buildAccountReportReviewAction(database.pool, 'ModerationAction');

    const responses = await Promise.all([
      call(action, reportId, { reason: 'First reviewer' }),
      call(action, reportId, { reason: 'Second reviewer' }),
    ]);
    assert.deepEqual(responses.map((item) => item.notice.type).sort(), ['error', 'success']);

    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions WHERE action_type = 'ACCOUNT_REPORT_REVIEWED_NO_ACTION'`,
    );
    assert.equal(audits.rows[0].count, 1);
    const report = (await database.pool.query(`SELECT review_outcome FROM account_reports WHERE id = $1`, [reportId]))
      .rows[0];
    assert.equal(report.review_outcome, 'NO_ACTION');
  });

  it('closes every open Post Report when the Post is removed and correlates the audit', async () => {
    const authorId = await insertUser('removed-post-author');
    const postId = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'Reported post',
    });
    const firstReporter = await insertUser('post-reporter-1');
    const secondReporter = await insertUser('post-reporter-2');
    const completedReporter = await insertUser('post-reporter-3');

    const firstOpen = await insertPostReport({ postId, reporterId: firstReporter });
    const secondOpen = await insertPostReport({ postId, reporterId: secondReporter });
    const completed = await insertPostReport({ postId, reporterId: completedReporter });
    await markReportReviewed('post_reports', completed, principals.adminId, 'NO_ACTION');
    const completedBefore = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM post_reports WHERE id = $1`, [completed])
    ).rows[0];

    const actions = buildPostActions(database.pool, 'ModerationAction');
    const response = await call(actions.removePost, postId, { reason: 'Policy violation' });
    assert.equal(response.notice.type, 'success');

    const closed = await database.pool.query(
      `SELECT id, reviewed_at, reviewed_by_admin_id, review_outcome
       FROM post_reports
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[firstOpen, secondOpen]],
    );
    assert.equal(closed.rows.length, 2);
    for (const row of closed.rows) {
      assert.ok(row.reviewed_at);
      assert.equal(row.reviewed_by_admin_id, principals.adminId);
      assert.equal(row.review_outcome, 'ACTION_TAKEN');
    }

    const completedAfter = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM post_reports WHERE id = $1`, [completed])
    ).rows[0];
    assert.deepEqual(completedAfter, completedBefore);

    const audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_REMOVED'`,
        [postId],
      )
    ).rows[0];
    assert.deepEqual([...audit.metadata.closedPostReportIds].sort(), [firstOpen, secondOpen].sort());

    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'REMOVED');
  });

  it('closes open Post Reports on approval, flagging, and restoration', async () => {
    const actions = buildPostActions(database.pool, 'ModerationAction');
    const authorId = await insertUser('transition-author');
    const reporter = await insertUser('transition-reporter');

    const approvedPost = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'Flagged approval post',
      moderationStatus: 'FLAGGED',
    });
    const approvedReport = await insertPostReport({ postId: approvedPost, reporterId: reporter });
    assert.equal((await call(actions.approvePost, approvedPost)).notice.type, 'success');
    let row = (await database.pool.query(`SELECT review_outcome FROM post_reports WHERE id = $1`, [approvedReport]))
      .rows[0];
    assert.equal(row.review_outcome, 'ACTION_TAKEN');
    let audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_APPROVED'`,
        [approvedPost],
      )
    ).rows[0];
    assert.deepEqual(audit.metadata.closedPostReportIds, [approvedReport]);

    const flaggedPost = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'Clean flag post',
      moderationStatus: 'CLEAN',
    });
    const flaggedReport = await insertPostReport({ postId: flaggedPost, reporterId: reporter });
    assert.equal((await call(actions.flagPost, flaggedPost, { reason: 'Manual review' })).notice.type, 'success');
    row = (await database.pool.query(`SELECT review_outcome FROM post_reports WHERE id = $1`, [flaggedReport])).rows[0];
    assert.equal(row.review_outcome, 'ACTION_TAKEN');
    audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_FLAGGED'`,
        [flaggedPost],
      )
    ).rows[0];
    assert.deepEqual(audit.metadata.closedPostReportIds, [flaggedReport]);

    const removedPost = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'Restored post',
      status: 'REMOVED',
    });
    const removedReport = await insertPostReport({ postId: removedPost, reporterId: reporter });
    assert.equal((await call(actions.restorePost, removedPost)).notice.type, 'success');
    row = (await database.pool.query(`SELECT review_outcome FROM post_reports WHERE id = $1`, [removedReport])).rows[0];
    assert.equal(row.review_outcome, 'ACTION_TAKEN');
    audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_RESTORED'`,
        [removedPost],
      )
    ).rows[0];
    assert.deepEqual(audit.metadata.closedPostReportIds, [removedReport]);
  });

  it('closes every open Comment Report when a Comment is removed', async () => {
    const postId = await insertPost(database.pool, { ...principals, title: 'Comment report closure post' });
    const authorId = await insertUser('comment-author');
    const comment = await database.pool.query(
      `INSERT INTO comments (post_id, author_id, text, status)
       VALUES ($1, $2, 'Reported contribution', 'HIDDEN')
       RETURNING id`,
      [postId, authorId],
    );
    const commentId = comment.rows[0].id;
    const firstReporter = await insertUser('comment-reporter-1');
    const secondReporter = await insertUser('comment-reporter-2');
    const completedReporter = await insertUser('comment-reporter-3');

    const firstOpen = await insertCommentReport({ commentId, reporterId: firstReporter });
    const secondOpen = await insertCommentReport({ commentId, reporterId: secondReporter });
    const completed = await insertCommentReport({ commentId, reporterId: completedReporter });
    await database.pool.query(`UPDATE comment_reports SET reviewed_at = now() WHERE id = $1`, [completed]);
    const completedBefore = (
      await database.pool.query(`SELECT reviewed_at FROM comment_reports WHERE id = $1`, [completed])
    ).rows[0];

    const actions = buildCommentActions(database.pool, 'ModerationAction');
    const response = await call(actions.removeComment, commentId, { reason: 'Abusive' });
    assert.equal(response.notice.type, 'success');

    const closed = await database.pool.query(
      `SELECT id, reviewed_at FROM comment_reports WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[firstOpen, secondOpen]],
    );
    assert.equal(closed.rows.length, 2);
    for (const row2 of closed.rows) assert.ok(row2.reviewed_at);
    const completedAfter = (
      await database.pool.query(`SELECT reviewed_at FROM comment_reports WHERE id = $1`, [completed])
    ).rows[0];
    assert.deepEqual(completedAfter, completedBefore);

    const audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'COMMENT_REMOVED'`,
        [commentId],
      )
    ).rows[0];
    assert.deepEqual([...audit.metadata.closedCommentReportIds].sort(), [firstOpen, secondOpen].sort());
  });

  it('closes every open Pupzy Account Report when the account is banned', async () => {
    const targetId = await insertUser('ban-target');
    const firstReporter = await insertUser('account-reporter-1');
    const secondReporter = await insertUser('account-reporter-2');
    const completedReporter = await insertUser('account-reporter-3');

    const firstOpen = await insertAccountReport({ reporterId: firstReporter, reportedUserId: targetId });
    const secondOpen = await insertAccountReport({ reporterId: secondReporter, reportedUserId: targetId });
    const completed = await insertAccountReport({ reporterId: completedReporter, reportedUserId: targetId });
    await markReportReviewed('account_reports', completed, principals.adminId, 'NO_ACTION');
    const completedBefore = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM account_reports WHERE id = $1`, [completed])
    ).rows[0];

    const response = await call(buildBanUserAction(database.pool, 'ModerationAction'), targetId, {
      reason: 'Coordinated abuse',
    });
    assert.equal(response.notice.type, 'success');

    const closed = await database.pool.query(
      `SELECT id, reviewed_at, reviewed_by_admin_id, review_outcome
       FROM account_reports
       WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[firstOpen, secondOpen]],
    );
    assert.equal(closed.rows.length, 2);
    for (const row of closed.rows) {
      assert.ok(row.reviewed_at);
      assert.equal(row.reviewed_by_admin_id, principals.adminId);
      assert.equal(row.review_outcome, 'ACTION_TAKEN');
    }

    const completedAfter = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM account_reports WHERE id = $1`, [completed])
    ).rows[0];
    assert.deepEqual(completedAfter, completedBefore);

    const audit = (
      await database.pool.query(
        `SELECT metadata FROM moderation_actions WHERE target_id = $1 AND action_type = 'USER_BANNED'`,
        [targetId],
      )
    ).rows[0];
    assert.deepEqual([...audit.metadata.closedAccountReportIds].sort(), [firstOpen, secondOpen].sort());
  });

  it('reviews reports despite an active Block between the reporter and reported account', async () => {
    const reportedId = await insertUser('blocked-reported');
    await database.pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
      principals.userId,
      reportedId,
    ]);

    const postId = await insertPost(database.pool, {
      userId: reportedId,
      cityId: principals.cityId,
      title: 'Blocked evidence post',
      moderationStatus: 'FLAGGED',
    });
    const postReportId = await insertPostReport({ postId, reporterId: principals.userId });
    const postResponse = await call(buildPostReportReviewAction(database.pool, 'ModerationAction'), postReportId, {
      reason: 'Reviewed despite Block',
    });
    assert.equal(postResponse.notice.type, 'success');
    const closedPostReport = (
      await database.pool.query(`SELECT review_outcome FROM post_reports WHERE id = $1`, [postReportId])
    ).rows[0];
    assert.equal(closedPostReport.review_outcome, 'NO_ACTION');
    assert.ok(
      (await database.pool.query(`SELECT 1 FROM posts WHERE id = $1`, [postId])).rows.length,
      'the moderated evidence Post remains inspectable despite the Block',
    );

    const reportId = await insertAccountReport({
      reporterId: principals.userId,
      reportedUserId: reportedId,
      reason: 'HARASSMENT',
    });

    const action = buildAccountReportReviewAction(database.pool, 'ModerationAction');
    const response = await call(action, reportId, { reason: 'Reviewed with full evidence' });
    assert.equal(response.notice.type, 'success');

    const report = (await database.pool.query(`SELECT review_outcome FROM account_reports WHERE id = $1`, [reportId]))
      .rows[0];
    assert.equal(report.review_outcome, 'NO_ACTION');
    const accountAuditCount = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'ACCOUNT_REPORT_REVIEWED_NO_ACTION'`,
      [reportedId],
    );
    assert.equal(accountAuditCount.rows[0].count, 1);
    const postAuditCount = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'POST_REPORT_REVIEWED_NO_ACTION'`,
      [postId],
    );
    assert.equal(postAuditCount.rows[0].count, 1);
  });

  it('rolls back the target mutation and report closure when the audit insert fails', async () => {
    const authorId = await insertUser('rollback-author');
    const reporterId = await insertUser('rollback-reporter');
    const postId = await insertPost(database.pool, {
      userId: authorId,
      cityId: principals.cityId,
      title: 'Audit rollback post',
    });
    const reportId = await insertPostReport({ postId, reporterId });
    const actions = buildPostActions(database.pool, 'ModerationAction');

    await withFailureTrigger({ table: 'moderation_actions', event: 'INSERT', suffix: 'audit' }, async () => {
      await assert.rejects(
        () => call(actions.removePost, postId, { reason: 'Policy violation' }),
        /forced audit failure/,
      );
    });

    const postAfterFailure = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(postAfterFailure.status, 'ACTIVE');
    const reportAfterFailure = (
      await database.pool.query(`SELECT reviewed_at FROM post_reports WHERE id = $1`, [reportId])
    ).rows[0];
    assert.equal(reportAfterFailure.reviewed_at, null);
    const notificationCount = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notificationCount.rows[0].count, 0);
    const auditCount = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(auditCount.rows[0].count, 0);

    const retry = await call(actions.removePost, postId, { reason: 'Policy violation' });
    assert.equal(retry.notice.type, 'success');
    const finalPost = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(finalPost.status, 'REMOVED');
    const finalReport = (await database.pool.query(`SELECT review_outcome FROM post_reports WHERE id = $1`, [reportId]))
      .rows[0];
    assert.equal(finalReport.review_outcome, 'ACTION_TAKEN');
  });

  it('rolls back a no-action review when the report closure fails', async () => {
    const reportedId = await insertUser('rollback-reported');
    const reportId = await insertAccountReport({ reporterId: principals.userId, reportedUserId: reportedId });
    const action = buildAccountReportReviewAction(database.pool, 'ModerationAction');

    await withFailureTrigger({ table: 'account_reports', event: 'UPDATE', suffix: 'report' }, async () => {
      await assert.rejects(() => call(action, reportId, { reason: 'Should not commit' }), /forced report failure/);
    });

    const reportAfterFailure = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM account_reports WHERE id = $1`, [reportId])
    ).rows[0];
    assert.equal(reportAfterFailure.reviewed_at, null);
    assert.equal(reportAfterFailure.review_outcome, null);
    const auditCount = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(auditCount.rows[0].count, 0);

    const retry = await call(action, reportId, { reason: 'Retried after fault removal' });
    assert.equal(retry.notice.type, 'success');
    const finalReport = (
      await database.pool.query(`SELECT review_outcome FROM account_reports WHERE id = $1`, [reportId])
    ).rows[0];
    assert.equal(finalReport.review_outcome, 'NO_ACTION');
    const finalAudits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(finalAudits.rows[0].count, 1);
  });
});

describe('dashboard queries', () => {
  it('counts only active pending or flagged posts as needing review', async () => {
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'FLAGGED',
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'CLEAN',
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
      status: 'REMOVED',
    });
    const stats = await computeStats(database.pool);
    assert.equal(stats.needs_review_posts, '3');
  });

  it('sorts review rows by reports then creation time and excludes clean/removed posts', async () => {
    const expected = [];
    for (let index = 0; index < 10; index += 1) {
      const included = index < 6;
      const id = await insertPost(database.pool, {
        ...principals,
        title: `Post ${index}`,
        moderationStatus: included ? (index % 2 ? 'FLAGGED' : 'PENDING_AUTO_REVIEW') : 'CLEAN',
        status: index === 9 ? 'REMOVED' : 'ACTIVE',
        reportCount: included ? Math.floor(index / 2) : 100,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
      if (included) expected.push(id);
    }
    const result = await database.pool.query(`
      SELECT id, moderation_status, status
      FROM posts
      WHERE moderation_status IN ('PENDING_AUTO_REVIEW', 'FLAGGED') AND status = 'ACTIVE'
      ORDER BY report_count DESC, created_at DESC
      LIMIT 25
    `);
    assert.deepEqual(
      result.rows.map((row) => row.id),
      expected.reverse(),
    );
    assert.equal(
      result.rows.every((row) => row.status === 'ACTIVE' && row.moderation_status !== 'CLEAN'),
      true,
    );
  });

  describe('comment moderation actions', () => {
    it('restores hidden comment, restores post comment count, marks reports reviewed, and writes audit row', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Comment post' });
      const commentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status)
         VALUES ($1, $2, 'Hidden comment', 'HIDDEN')
         RETURNING id`,
        [postId, principals.userId],
      );
      const commentId = commentRes.rows[0].id;

      await database.pool.query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason, details)
         VALUES ($1, $2, 'SPAM', 'Spam details')`,
        [commentId, principals.userId],
      );

      const actions = buildCommentActions(database.pool, 'ModerationAction');
      const response = await call(actions.restoreComment, commentId, {
        reason: 'Restoring compliant comment',
      });
      assert.equal(response.notice?.type, 'success');

      const comment = await database.pool.query(`SELECT status FROM comments WHERE id = $1`, [commentId]);
      assert.equal(comment.rows[0].status, 'ACTIVE');

      const post = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [postId]);
      assert.equal(post.rows[0].comment_count, 1);

      const reports = await database.pool.query(`SELECT reviewed_at FROM comment_reports WHERE comment_id = $1`, [
        commentId,
      ]);
      assert.notEqual(reports.rows[0].reviewed_at, null);

      const audit = await database.pool.query(
        `SELECT action_type, reason, target_type, metadata FROM moderation_actions WHERE target_id = $1`,
        [commentId],
      );
      assert.equal(audit.rows[0].action_type, 'COMMENT_RESTORED');
      assert.equal(audit.rows[0].target_type, 'COMMENT');
      assert.equal(audit.rows[0].reason, 'Restoring compliant comment');
      assert.equal(audit.rows[0].metadata.closedCommentReportIds.length, 1);
    });

    it('rejects restoration of active, deleted, or removed comment', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Active comment post' });
      const commentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status)
         VALUES ($1, $2, 'Active comment', 'ACTIVE')
         RETURNING id`,
        [postId, principals.userId],
      );
      const commentId = commentRes.rows[0].id;

      const actions = buildCommentActions(database.pool, 'ModerationAction');
      const response = await call(actions.restoreComment, commentId, {
        reason: 'Attempt invalid restore',
      });
      assert.equal(response.notice?.type, 'error');
      assert.match(response.notice?.message, /Only hidden comments can be restored/);
    });

    it('inspectMedia returns ordered media and reports for hidden comments', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Inspect media post' });
      const commentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status)
         VALUES ($1, $2, 'Image hidden comment', 'IMAGE_HIDDEN')
         RETURNING id`,
        [postId, principals.userId],
      );
      const commentId = commentRes.rows[0].id;

      await database.pool.query(
        `INSERT INTO comment_media (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
         VALUES ($1, 'comments/c1/img1.webp', '1111111111111111111111111111111111111111111111111111111111111111', 480, 320, 25000, 'image/webp', 0),
                ($1, 'comments/c1/img2.webp', '2222222222222222222222222222222222222222222222222222222222222222', 400, 400, 35000, 'image/webp', 1)`,
        [commentId],
      );

      await database.pool.query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason, details)
         VALUES ($1, $2, 'INAPPROPRIATE_CONTENT', 'Bad photo')`,
        [commentId, principals.userId],
      );

      const actions = buildCommentActions(database.pool, 'ModerationAction');
      const result = await actions.inspectMedia.handler(
        { method: 'get' },
        null,
        context(commentId, principals.adminId),
      );

      assert.equal(result.media.length, 2);
      assert.equal(result.media[0].display_order, 0);
      assert.equal(result.media[0].storage_key, 'comments/c1/img1.webp');
      assert.equal(result.media[1].display_order, 1);
      assert.equal(result.media[1].storage_key, 'comments/c1/img2.webp');

      assert.equal(result.reports.length, 1);
      assert.equal(result.reports[0].reason, 'INAPPROPRIATE_CONTENT');
      assert.equal(result.reports[0].reviewed_at, null);
    });

    it('removeComment on parent with visible replies decrements post comment_count by 1 + replies, clears pins, and sets reply_count to 0', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Parent removal post' });
      await database.pool.query(`UPDATE posts SET comment_count = 3 WHERE id = $1`, [postId]);

      const parentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status, reply_count)
         VALUES ($1, $2, 'Parent comment', 'ACTIVE', 2)
         RETURNING id`,
        [postId, principals.userId],
      );
      const parentId = parentRes.rows[0].id;

      // Pin the parent comment
      await database.pool.query(`INSERT INTO post_pins (post_id, comment_id) VALUES ($1, $2)`, [postId, parentId]);

      // Insert 2 visible replies
      await database.pool.query(
        `INSERT INTO comments (post_id, author_id, parent_id, text, status)
         VALUES ($1, $2, $3, 'Reply 1', 'ACTIVE'),
                ($1, $2, $3, 'Reply 2', 'ACTIVE')`,
        [postId, principals.userId, parentId],
      );

      const actions = buildCommentActions(database.pool, 'ModerationAction');
      const response = await call(actions.removeComment, parentId, {
        reason: 'Abusive thread violation',
      });
      assert.equal(response.notice?.type, 'success');

      // Verify parent is REMOVED and reply_count is 0
      const parentRow = await database.pool.query(`SELECT status, reply_count FROM comments WHERE id = $1`, [parentId]);
      assert.equal(parentRow.rows[0].status, 'REMOVED');
      assert.equal(parentRow.rows[0].reply_count, 0);

      // Verify pin was deleted
      const pins = await database.pool.query(`SELECT * FROM post_pins WHERE comment_id = $1`, [parentId]);
      assert.equal(pins.rows.length, 0);

      // Verify post comment_count decremented by 3 (1 parent + 2 replies) -> 0
      const postRow = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [postId]);
      assert.equal(postRow.rows[0].comment_count, 0);
    });

    it('removeComment on whole-hidden parent with visible replies removes phantom reply count', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Hidden parent post' });
      // Post comment_count currently 2 (since parent was whole-hidden, only replies were counted)
      await database.pool.query(`UPDATE posts SET comment_count = 2 WHERE id = $1`, [postId]);

      const parentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status, reply_count)
         VALUES ($1, $2, 'Hidden parent', 'HIDDEN', 2)
         RETURNING id`,
        [postId, principals.userId],
      );
      const parentId = parentRes.rows[0].id;

      await database.pool.query(
        `INSERT INTO comments (post_id, author_id, parent_id, text, status)
         VALUES ($1, $2, $3, 'Reply 1', 'ACTIVE'),
                ($1, $2, $3, 'Reply 2', 'IMAGE_HIDDEN')`,
        [postId, principals.userId, parentId],
      );

      const actions = buildCommentActions(database.pool, 'ModerationAction');
      const response = await call(actions.removeComment, parentId, {
        reason: 'Permanent removal of hidden thread',
      });
      assert.equal(response.notice?.type, 'success');

      // Post comment_count must be 0 (the 2 replies decremented)
      const postRow = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [postId]);
      assert.equal(postRow.rows[0].comment_count, 0);
    });

    it('removeComment on reply under already removed parent does not double-decrement post comment_count', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Reply removal post' });
      await database.pool.query(`UPDATE posts SET comment_count = 2 WHERE id = $1`, [postId]);

      const parentRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status, reply_count)
         VALUES ($1, $2, 'Parent comment', 'ACTIVE', 1)
         RETURNING id`,
        [postId, principals.userId],
      );
      const parentId = parentRes.rows[0].id;

      const replyRes = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, parent_id, text, status)
         VALUES ($1, $2, $3, 'Reply to be removed', 'ACTIVE')
         RETURNING id`,
        [postId, principals.userId, parentId],
      );
      const replyId = replyRes.rows[0].id;

      const actions = buildCommentActions(database.pool, 'ModerationAction');

      // 1. Permanently remove parent comment
      await call(actions.removeComment, parentId, { reason: 'Remove thread parent' });

      // Post comment_count is now 0 (both parent and reply decremented)
      const postAfterParentRemoval = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [
        postId,
      ]);
      assert.equal(postAfterParentRemoval.rows[0].comment_count, 0);

      // 2. Now remove the reply under the already-removed parent
      const replyResponse = await call(actions.removeComment, replyId, { reason: 'Remove reply' });
      assert.equal(replyResponse.notice?.type, 'success');

      // Status is REMOVED
      const replyRow = await database.pool.query(`SELECT status FROM comments WHERE id = $1`, [replyId]);
      assert.equal(replyRow.rows[0].status, 'REMOVED');

      // Post comment_count must NOT be double-decremented (remains 0)
      const postAfterReplyRemoval = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [
        postId,
      ]);
      assert.equal(postAfterReplyRemoval.rows[0].comment_count, 0);

      // Parent reply_count remains 0
      const parentRow = await database.pool.query(`SELECT reply_count FROM comments WHERE id = $1`, [parentId]);
      assert.equal(parentRow.rows[0].reply_count, 0);
    });

    it('serializes concurrent restore and removal with durable state and audit outcomes', async () => {
      const postId = await insertPost(database.pool, { ...principals, title: 'Ticket 11 moderation race' });
      const comment = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, text, status, reply_count)
         VALUES ($1, $2, 'Hidden moderation race target', 'HIDDEN', 0)
         RETURNING id`,
        [postId, principals.userId],
      );
      const commentId = comment.rows[0].id;
      const actions = buildCommentActions(database.pool, 'ModerationAction');

      const results = await Promise.race([
        Promise.all([
          call(actions.restoreComment, commentId, { reason: 'Confirmed clean' }),
          call(actions.removeComment, commentId, { reason: 'Permanent policy removal' }),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AdminJS moderation race timed out')), 5000)),
      ]);

      assert.equal(results[1].notice.type, 'success');
      assert.equal(['success', 'error'].includes(results[0].notice.type), true);
      const finalComment = await database.pool.query(`SELECT status, reply_count FROM comments WHERE id = $1`, [
        commentId,
      ]);
      assert.equal(finalComment.rows[0].status, 'REMOVED');
      assert.equal(finalComment.rows[0].reply_count, 0);
      const finalPost = await database.pool.query(`SELECT comment_count FROM posts WHERE id = $1`, [postId]);
      assert.equal(finalPost.rows[0].comment_count, 0);
      const audits = await database.pool.query(
        `SELECT action_type FROM moderation_actions WHERE target_id = $1 ORDER BY created_at`,
        [commentId],
      );
      assert.equal(audits.rows.filter((row) => row.action_type === 'COMMENT_REMOVED').length, 1);
      assert.equal(audits.rows.length >= 1 && audits.rows.length <= 2, true);
    });
  });
});
