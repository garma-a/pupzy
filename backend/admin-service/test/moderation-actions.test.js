import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  buildBanUserAction,
  buildUnbanUserAction,
} from "../src/adminjs/actions/ban-user.action.js";
import { buildPostActions } from "../src/adminjs/actions/moderate-post.actions.js";
import { computeStats } from "../src/adminjs/dashboard/dashboard-cache.js";
import {
  TestDatabaseHelper,
  insertPost,
  seedPrincipals,
} from "./test-database.helper.js";

const database = new TestDatabaseHelper();
let principals;

function context(id, adminId) {
  return {
    record: { id: () => id, toJSON: () => ({ id, params: {} }) },
    currentAdmin: {
      id: adminId,
      role: "SUPER_ADMIN",
      email: "admin@example.com",
    },
  };
}

async function call(action, id, payload = {}) {
  return action.handler(
    { method: "post", payload },
    null,
    context(id, principals.adminId),
  );
}

before(async () => database.start());
beforeEach(async () => {
  await database.clean();
  principals = await seedPrincipals(database.pool);
});
after(async () => database.stop());

describe("moderation actions", () => {
  it("bans a user and writes exactly one audit row", async () => {
    const response = await call(
      buildBanUserAction(database.pool, "ModerationAction"),
      principals.userId,
      {
        reason: "Repeated scams",
      },
    );
    assert.equal(response.notice.type, "success");
    const user = await database.pool.query(
      "SELECT is_banned, ban_reason FROM users WHERE id = $1",
      [principals.userId],
    );
    assert.equal(user.rows[0].is_banned, true);
    assert.equal(user.rows[0].ban_reason, "Repeated scams");
    const audit = await database.pool.query(
      `SELECT action_type FROM moderation_actions WHERE target_id = $1`,
      [principals.userId],
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action_type),
      ["USER_BANNED"],
    );
  });

  it("serializes concurrent bans so only one succeeds", async () => {
    const action = buildBanUserAction(database.pool, "ModerationAction");
    const responses = await Promise.all([
      call(action, principals.userId, { reason: "Abuse" }),
      call(action, principals.userId, { reason: "Abuse" }),
    ]);
    assert.deepEqual(responses.map((item) => item.notice.type).sort(), [
      "error",
      "success",
    ]);
    const audit = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'USER_BANNED'`,
      [principals.userId],
    );
    assert.equal(audit.rows[0].count, 1);
  });

  it("rejects an empty ban reason without database writes", async () => {
    const response = await call(
      buildBanUserAction(database.pool, "ModerationAction"),
      principals.userId,
      {
        reason: "   ",
      },
    );
    assert.equal(response.notice.type, "error");
    const state = await database.pool.query(
      `SELECT is_banned, (SELECT count(*)::int FROM moderation_actions) AS audit_count
       FROM users WHERE id = $1`,
      [principals.userId],
    );
    assert.equal(state.rows[0].is_banned, false);
    assert.equal(state.rows[0].audit_count, 0);
  });

  it("optionally removes only active posts and sends one batched notification", async () => {
    for (let index = 0; index < 3; index += 1) {
      await insertPost(database.pool, {
        ...principals,
        title: `Active ${index}`,
      });
    }
    await insertPost(database.pool, {
      ...principals,
      title: "Already removed",
      status: "REMOVED",
    });

    await call(
      buildBanUserAction(database.pool, "ModerationAction"),
      principals.userId,
      {
        reason: "Coordinated spam",
        alsoRemovePosts: true,
      },
    );
    const posts = await database.pool.query(
      `SELECT title, status FROM posts ORDER BY title`,
    );
    assert.equal(
      posts.rows.filter((row) => row.status === "REMOVED").length,
      4,
    );
    const notifications = await database.pool.query(
      `SELECT type FROM notifications`,
    );
    assert.deepEqual(
      notifications.rows.map((row) => row.type),
      ["POST_REMOVED_BY_ADMIN"],
    );
    const audit = await database.pool.query(
      `SELECT metadata FROM moderation_actions`,
    );
    assert.equal(audit.rows[0].metadata.cascadedPostCount, 3);
  });

  it("does not send an empty removal notification when the banned user has no posts", async () => {
    const response = await call(
      buildBanUserAction(database.pool, "ModerationAction"),
      principals.userId,
      {
        reason: "Harassment",
        alsoRemovePosts: true,
      },
    );
    assert.equal(response.notice.type, "success");
    const notifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications`,
    );
    assert.equal(notifications.rows[0].count, 0);
  });

  it("rejects unbanning an already-unbanned user", async () => {
    const response = await call(
      buildUnbanUserAction(database.pool),
      principals.userId,
    );
    assert.equal(response.notice.type, "error");
    assert.match(response.notice.message, /not banned/i);
    const audit = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions`,
    );
    assert.equal(audit.rows[0].count, 0);
  });

  it("enforces all post state-machine transitions under the row lock", async () => {
    const postId = await insertPost(database.pool, principals);
    const actions = buildPostActions(database.pool, "ModerationAction");

    assert.equal(
      (await call(actions.approvePost, postId)).notice.type,
      "success",
    );
    assert.equal(
      (await call(actions.approvePost, postId)).notice.type,
      "error",
    );
    assert.equal(
      (await call(actions.flagPost, postId, { reason: "Suspicious" })).notice
        .type,
      "success",
    );
    assert.equal(
      (await call(actions.flagPost, postId, { reason: "Again" })).notice.type,
      "error",
    );
    assert.equal(
      (await call(actions.removePost, postId, { reason: "Policy violation" }))
        .notice.type,
      "success",
    );
    assert.equal(
      (await call(actions.removePost, postId, { reason: "Again" })).notice.type,
      "error",
    );
    assert.equal(
      (await call(actions.restorePost, postId)).notice.type,
      "success",
    );
    assert.equal(
      (await call(actions.restorePost, postId)).notice.type,
      "error",
    );

    const audits = await database.pool.query(
      `SELECT action_type FROM moderation_actions WHERE target_id = $1 ORDER BY created_at`,
      [postId],
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action_type),
      ["POST_APPROVED", "POST_FLAGGED", "POST_REMOVED", "POST_RESTORED"],
    );
  });

  it("removePost inserts one correctly linked notification", async () => {
    const postId = await insertPost(database.pool, principals);
    await call(
      buildPostActions(database.pool, "ModerationAction").removePost,
      postId,
      { reason: "Spam" },
    );
    const notifications = await database.pool.query(
      `SELECT type, related_post_id FROM notifications WHERE recipient_id = $1`,
      [principals.userId],
    );
    assert.equal(notifications.rows.length, 1);
    assert.equal(notifications.rows[0].type, "POST_REMOVED_BY_ADMIN");
    assert.equal(notifications.rows[0].related_post_id, postId);
  });

  it("stores SQL injection text literally without executing it", async () => {
    const postId = await insertPost(database.pool, principals);
    const reason = "x'; DROP TABLE posts; --";
    await call(
      buildPostActions(database.pool, "ModerationAction").flagPost,
      postId,
      { reason },
    );
    const result = await database.pool.query(
      `SELECT moderation_reason FROM posts WHERE id = $1`,
      [postId],
    );
    assert.equal(result.rows[0].moderation_reason, reason);
    assert.equal(
      (await database.pool.query(`SELECT count(*)::int AS count FROM posts`))
        .rows[0].count,
      1,
    );
  });

  it("round-trips XSS-shaped moderation text without storage-layer mangling", async () => {
    const postId = await insertPost(database.pool, principals);
    const reason = "<script>alert(1)</script>";
    await call(
      buildPostActions(database.pool, "ModerationAction").flagPost,
      postId,
      { reason },
    );
    const result = await database.pool.query(
      `SELECT moderation_reason FROM posts WHERE id = $1`,
      [postId],
    );
    assert.equal(result.rows[0].moderation_reason, reason);
  });
});

describe("dashboard queries", () => {
  it("counts only active pending or flagged posts as needing review", async () => {
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: "PENDING_AUTO_REVIEW",
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: "PENDING_AUTO_REVIEW",
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: "FLAGGED",
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: "CLEAN",
    });
    await insertPost(database.pool, {
      ...principals,
      moderationStatus: "PENDING_AUTO_REVIEW",
      status: "REMOVED",
    });
    const stats = await computeStats(database.pool);
    assert.equal(stats.needs_review_posts, "3");
  });

  it("sorts review rows by reports then creation time and excludes clean/removed posts", async () => {
    const expected = [];
    for (let index = 0; index < 10; index += 1) {
      const included = index < 6;
      const id = await insertPost(database.pool, {
        ...principals,
        title: `Post ${index}`,
        moderationStatus: included
          ? index % 2
            ? "FLAGGED"
            : "PENDING_AUTO_REVIEW"
          : "CLEAN",
        status: index === 9 ? "REMOVED" : "ACTIVE",
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
      result.rows.every(
        (row) => row.status === "ACTIVE" && row.moderation_status !== "CLEAN",
      ),
      true,
    );
  });
});
