import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  POST_REVIEW_DISCUSSION_ACTION,
  POST_REVIEW_DISCUSSION_PARAM,
  POST_REVIEW_WORKSPACE_PARAM,
  attachPostReviewData,
  buildPostReviewActions,
  commentStatusLabel,
  formatPostAge,
  loadDiscussion,
  loadHistory,
  loadPostReview,
  lostSubtypeLabel,
  moderationActionHistoryLabel,
  moderationActionLabel,
  moderationStatusLabel,
  normalizeDiscussionPage,
  postStatusLabel,
  postTypeLabel,
  reportReasonLabel,
  resolveCommentMediaUrl,
  reviewOutcomeLabel,
} from './post-review.js';
import { buildPostsResource } from '../resources/posts.resource.js';

const db = { table: (name) => ({ name }) };

function createMockPool(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const handler of handlers) {
        const result = handler(sql, params);
        if (result) return result;
      }
      return { rows: [] };
    },
  };
}

function buildDiscussionHandlers({ total = 0, topLevel = [], replies = [], media = [] } = {}) {
  return [
    (sql) => (sql.includes('count(*)::int AS total') ? { rows: [{ total }] } : null),
    (sql) => (sql.includes('AND c.parent_id IS NULL') ? { rows: topLevel } : null),
    (sql) => (sql.includes('WHERE c.parent_id = ANY') ? { rows: replies } : null),
    (sql) => (sql.includes('FROM comment_media') ? { rows: media } : null),
  ];
}

function commentRow(overrides = {}) {
  return {
    id: 'comment-1',
    parent_id: null,
    text: 'Found the dog near the market.',
    status: 'ACTIVE',
    reply_count: 0,
    boost_count: 0,
    created_at: new Date('2026-09-15T10:00:00Z'),
    author_name: 'Community Member',
    ...overrides,
  };
}

describe('Post review workspace labels and media URLs', () => {
  it('renders readable labels for Post, moderation, Comment, action, reason and outcome values', () => {
    assert.equal(postTypeLabel('LOST'), 'Lost & found');
    assert.equal(postTypeLabel('RESCUE'), 'Rescue');
    assert.equal(postStatusLabel('REUNITED'), 'Reunited');
    assert.equal(moderationStatusLabel('PENDING_AUTO_REVIEW'), 'Pending review');
    assert.equal(commentStatusLabel('IMAGE_HIDDEN'), 'Image hidden');
    assert.equal(commentStatusLabel('REMOVED'), 'Removed');
    assert.equal(moderationActionLabel('POST_FLAGGED'), 'Post flagged');
    assert.equal(moderationActionLabel('COMMENT_REMOVED'), 'Comment removed');
    assert.equal(reportReasonLabel('INAPPROPRIATE_CONTENT'), 'Inappropriate content');
    assert.equal(reviewOutcomeLabel('NO_ACTION'), 'No action');
  });

  it('renders readable labels for lost subtypes, account actions and future lifecycle values', () => {
    assert.equal(lostSubtypeLabel('LOST_PET'), 'Lost pet');
    assert.equal(lostSubtypeLabel('FOUND_STRAY'), 'Found stray');
    assert.equal(moderationActionLabel('USER_BANNED'), 'User banned');
    assert.equal(
      moderationActionLabel('ACCOUNT_REPORT_REVIEWED_NO_ACTION'),
      'Pupzy Account Report reviewed — no action',
    );
    assert.equal(postStatusLabel('EXPIRED'), 'Expired');
    assert.equal(postStatusLabel(null), 'Unknown');
  });

  it('renders the recorded administrator resolution outcome in the action history', () => {
    assert.equal(moderationActionHistoryLabel('POST_RESOLVED', { outcome: 'ADOPTED' }), 'Post marked adopted');
    assert.equal(moderationActionHistoryLabel('POST_RESOLVED', { outcome: 'REUNITED' }), 'Post marked reunited');
    assert.equal(moderationActionHistoryLabel('POST_RESOLVED', null), 'Post resolution recorded');
    assert.equal(moderationActionHistoryLabel('POST_REMOVED', { outcome: 'ADOPTED' }), 'Post removed');
  });

  it('normalizes invalid or non-positive discussion pages to page 1', () => {
    assert.equal(normalizeDiscussionPage(undefined), 1);
    assert.equal(normalizeDiscussionPage(''), 1);
    assert.equal(normalizeDiscussionPage('0'), 1);
    assert.equal(normalizeDiscussionPage('-3'), 1);
    assert.equal(normalizeDiscussionPage('not-a-number'), 1);
    assert.equal(normalizeDiscussionPage('4'), 4);
    assert.equal(normalizeDiscussionPage(['5']), 5);
  });

  it('derives Comment media URLs from the configured delivery base and rejects empty keys', () => {
    assert.equal(
      resolveCommentMediaUrl('comments/c1/m1.webp', { COMMENT_MEDIA_CDN_BASE: 'https://media.example.test/' }),
      'https://media.example.test/comments/c1/m1.webp',
    );
    assert.equal(
      resolveCommentMediaUrl('/comments/c1/m1.webp', { R2_PUBLIC_URL: 'https://r2.example.test' }),
      'https://r2.example.test/comments/c1/m1.webp',
    );
    assert.equal(resolveCommentMediaUrl('comments/c1/m1.webp', {}), 'https://cdn.pupzy.net/comments/c1/m1.webp');
    assert.equal(resolveCommentMediaUrl('', {}), null);
    assert.equal(resolveCommentMediaUrl(null, {}), null);
  });

  it('formats Post age without timezone drift', () => {
    const now = Date.parse('2026-09-15T12:00:00Z');
    assert.equal(formatPostAge('2026-09-15T09:00:00Z', now), 'Today');
    assert.equal(formatPostAge('2026-09-14T09:00:00Z', now), '1 day old');
    assert.equal(formatPostAge('2026-09-10T09:00:00Z', now), '5 days old');
    assert.equal(formatPostAge('not-a-date', now), 'Unknown age');
  });
});

describe('Post review workspace discussion loading', () => {
  it('loads one page of Comments with Replies, attachments and state labels', async () => {
    const pool = createMockPool(
      buildDiscussionHandlers({
        total: 12,
        topLevel: [
          commentRow({ id: 'c1', reply_count: 2 }),
          commentRow({ id: 'c2', status: 'HIDDEN', text: 'Hidden evidence' }),
        ],
        replies: [commentRow({ id: 'r1', parent_id: 'c1', status: 'REMOVED' })],
        media: [
          {
            id: 'm1',
            comment_id: 'c1',
            storage_key: 'comments/c1/m1.webp',
            width: 480,
            height: 320,
            file_content_type: 'image/webp',
            display_order: 0,
            created_at: new Date('2026-09-15T10:05:00Z'),
          },
        ],
      }),
    );

    const discussion = await loadDiscussion(pool, 'post-1', {
      page: 1,
      env: { COMMENT_MEDIA_CDN_BASE: 'https://media.example.test' },
    });

    assert.equal(discussion.page, 1);
    assert.equal(discussion.pageSize, 10);
    assert.equal(discussion.total, 12);
    assert.equal(discussion.totalPages, 2);
    assert.equal(discussion.itemCount, 2);

    const [first, second] = discussion.items;
    assert.equal(first.statusLabel, 'Active');
    assert.equal(first.attachments.length, 1);
    assert.equal(first.attachments[0].available, true);
    assert.equal(first.attachments[0].url, 'https://media.example.test/comments/c1/m1.webp');
    assert.equal(first.replies.length, 1);
    assert.equal(first.replies[0].statusLabel, 'Removed');
    assert.equal(second.statusLabel, 'Hidden');

    const topLevelQuery = pool.calls.find((call) => call.sql.includes('AND c.parent_id IS NULL'));
    assert.deepEqual(topLevelQuery.params, ['post-1', 10, 0]);
  });

  it('clamps a page beyond the last page and offsets the Comment query', async () => {
    const pool = createMockPool(
      buildDiscussionHandlers({
        total: 12,
        topLevel: [commentRow({ id: 'c11' })],
      }),
    );

    const discussion = await loadDiscussion(pool, 'post-1', { page: 99 });

    assert.equal(discussion.page, 2);
    assert.equal(discussion.totalPages, 2);
    const topLevelQuery = pool.calls.find((call) => call.sql.includes('AND c.parent_id IS NULL'));
    assert.deepEqual(topLevelQuery.params, ['post-1', 10, 10]);
  });

  it('returns an empty page without Comment or media queries when the discussion is empty', async () => {
    const pool = createMockPool(buildDiscussionHandlers({ total: 0 }));

    const discussion = await loadDiscussion(pool, 'post-1', { page: 1 });

    assert.equal(discussion.total, 0);
    assert.equal(discussion.totalPages, 1);
    assert.deepEqual(discussion.items, []);
    assert.equal(
      pool.calls.some((call) => call.sql.includes('FROM comment_media')),
      false,
    );
  });

  it('marks Comment attachments without a usable storage key as unavailable instead of failing', async () => {
    const pool = createMockPool(
      buildDiscussionHandlers({
        total: 1,
        topLevel: [commentRow({ id: 'c1' })],
        media: [
          { id: 'm1', comment_id: 'c1', storage_key: '', width: 480, height: 320, display_order: 0 },
          {
            id: 'm2',
            comment_id: 'c1',
            storage_key: 'comments/c1/kept.webp',
            width: 480,
            height: 320,
            display_order: 1,
          },
        ],
      }),
    );

    const discussion = await loadDiscussion(pool, 'post-1');

    assert.equal(discussion.items[0].attachments.length, 2);
    assert.equal(discussion.items[0].attachments[0].available, false);
    assert.equal(discussion.items[0].attachments[0].url, null);
    assert.equal(discussion.items[0].attachments[1].available, true);
  });
});

describe('Post review workspace administrator history', () => {
  it('reads Post and Comment actions with readable labels, actors and reasons', async () => {
    const pool = createMockPool([
      (sql) =>
        sql.includes('FROM moderation_actions')
          ? {
              rows: [
                {
                  id: 'action-1',
                  action_type: 'COMMENT_REMOVED',
                  target_type: 'COMMENT',
                  target_id: 'comment-1',
                  reason: 'Abusive language',
                  metadata: null,
                  created_at: new Date('2026-09-15T10:00:00Z'),
                  admin_name: 'Staff Admin',
                  admin_email: 'staff@example.com',
                },
                {
                  id: 'action-2',
                  action_type: 'POST_APPROVED',
                  target_type: 'POST',
                  target_id: 'post-1',
                  reason: null,
                  metadata: null,
                  created_at: new Date('2026-09-14T10:00:00Z'),
                  admin_name: null,
                  admin_email: null,
                },
              ],
            }
          : null,
    ]);

    const history = await loadHistory(pool, 'post-1');

    assert.equal(history.length, 2);
    assert.equal(history[0].actionLabel, 'Comment removed');
    assert.equal(history[0].reason, 'Abusive language');
    assert.equal(history[0].adminName, 'Staff Admin');
    assert.equal(history[1].actionLabel, 'Post approved');
    assert.equal(history[1].adminName, 'Removed administrator');

    const query = pool.calls[0];
    assert.match(query.sql, /a\.target_type = 'POST' AND a\.target_id = \$1/);
    assert.match(query.sql, /FROM comments WHERE post_id = \$1/);
    assert.deepEqual(query.params, ['post-1', 50]);
  });
});

describe('Post review workspace payload', () => {
  const postRow = {
    id: 'post-1',
    title: 'Found stray near Maadi',
    description: 'Friendly dog with a red collar.',
    post_type: 'LOST',
    status: 'ACTIVE',
    moderation_status: 'FLAGGED',
    moderation_reason: 'Needs a second look',
    urgency: 'URGENT',
    area_name: 'Maadi',
    created_at: new Date('2026-09-10T09:00:00Z'),
    creator_id: 'owner-1',
    city_id: 'city-1',
    city_name: 'Cairo',
    city_name_arabic: 'القاهرة',
    city_governorate: 'Cairo',
    owner_name: 'Post Owner',
    owner_email: 'owner@example.com',
  };

  function createPayloadPool() {
    return createMockPool([
      ...buildDiscussionHandlers({ total: 0 }),
      (sql) => (sql.includes('FROM posts p') ? { rows: [postRow] } : null),
      (sql) => (sql.includes('FROM lost_posts') ? { rows: [{ report_type: 'FOUND_STRAY' }] } : null),
      (sql) =>
        sql.includes('FROM post_media')
          ? {
              rows: [
                {
                  id: 'media-1',
                  public_url: 'https://cdn.example.test/1.webp',
                  display_order: 0,
                  width: 800,
                  height: 600,
                },
                { id: 'media-2', public_url: '', display_order: 1, width: null, height: null },
              ],
            }
          : null,
      (sql) =>
        sql.includes('FROM post_reports')
          ? {
              rows: [
                {
                  id: 'report-open',
                  post_id: 'post-1',
                  reporter_id: 'reporter-1',
                  reporter_name: 'Reporter',
                  reason: 'INAPPROPRIATE_CONTENT',
                  details: 'Looks staged',
                  reviewed_at: null,
                  review_outcome: null,
                  created_at: new Date('2026-09-14T09:00:00Z'),
                },
                {
                  id: 'report-reviewed',
                  post_id: 'post-1',
                  reporter_id: 'reporter-2',
                  reporter_name: 'Second Reporter',
                  reason: 'SPAM',
                  details: null,
                  reviewed_at: new Date('2026-09-14T10:00:00Z'),
                  review_outcome: 'NO_ACTION',
                  created_at: new Date('2026-09-13T09:00:00Z'),
                },
              ],
            }
          : null,
      (sql) => (sql.includes('FROM comment_reports') ? { rows: [] } : null),
      (sql) =>
        sql.includes('FROM moderation_actions')
          ? {
              rows: [
                {
                  id: 'action-1',
                  action_type: 'POST_FLAGGED',
                  target_type: 'POST',
                  target_id: 'post-1',
                  reason: 'Needs a second look',
                  metadata: null,
                  created_at: new Date('2026-09-14T11:00:00Z'),
                  admin_name: 'Test Admin',
                  admin_email: 'admin@example.com',
                },
              ],
            }
          : null,
    ]);
  }

  it('assembles header, original photos, discussion, Reports and history for one Post', async () => {
    const review = await loadPostReview(createPayloadPool(), 'post-1');

    assert.equal(review.error, false);
    assert.equal(review.post.typeLabel, 'Lost & found');
    assert.equal(review.post.subtypeLabel, 'Found stray');
    assert.equal(review.post.statusLabel, 'Active');
    assert.equal(review.post.moderationStatusLabel, 'Flagged');
    assert.equal(review.post.cityName, 'Cairo');
    assert.equal(review.post.owner.name, 'Post Owner');
    assert.match(review.post.ageLabel, /day/);
    assert.equal(review.post.urgency, 'URGENT');

    assert.equal(review.photos.length, 2);
    assert.equal(review.photos[0].available, true);
    assert.equal(review.photos[1].available, false);
    assert.equal(review.photos[1].url, null);

    assert.equal(review.discussion.total, 0);

    assert.equal(review.reports.postReports.length, 2);
    assert.equal(review.reports.postReports[0].isOpen, true);
    assert.equal(review.reports.postReports[0].statusLabel, 'Open');
    assert.equal(review.reports.postReports[0].reasonLabel, 'Inappropriate content');
    assert.equal(review.reports.postReports[1].isOpen, false);
    assert.equal(review.reports.postReports[1].reviewOutcomeLabel, 'No action');
    assert.deepEqual(review.reports.commentReports, []);

    assert.equal(review.history.length, 1);
    assert.equal(review.history[0].actionLabel, 'Post flagged');
    assert.equal(review.history[0].adminName, 'Test Admin');
  });

  it('reports a clear error payload when the Post no longer exists', async () => {
    const pool = createMockPool([(sql) => (sql.includes('FROM posts p') ? { rows: [] } : null)]);
    const review = await loadPostReview(pool, 'missing-post');
    assert.equal(review.error, true);
    assert.match(review.message, /no longer exists/i);
  });
});

describe('Post review workspace attachment and action wiring', () => {
  it('attaches the workspace payload to the record after hook', async () => {
    const pool = createMockPool([
      ...buildDiscussionHandlers({ total: 0 }),
      (sql) =>
        sql.includes('FROM posts p')
          ? {
              rows: [
                {
                  id: 'post-1',
                  title: 'Post',
                  description: 'Description',
                  post_type: 'RESCUE',
                  status: 'ACTIVE',
                  moderation_status: 'CLEAN',
                  moderation_reason: null,
                  urgency: 'URGENT',
                  area_name: null,
                  created_at: new Date(),
                  creator_id: 'owner-1',
                  city_id: 'city-1',
                  city_name: 'Cairo',
                  city_governorate: 'Cairo',
                  owner_name: 'Owner',
                  owner_email: 'owner@example.com',
                },
              ],
            }
          : null,
      (sql) => (sql.includes('FROM post_media') ? { rows: [] } : null),
      (sql) => (sql.includes('FROM post_reports') ? { rows: [] } : null),
      (sql) => (sql.includes('FROM comment_reports') ? { rows: [] } : null),
      (sql) => (sql.includes('FROM moderation_actions') ? { rows: [] } : null),
    ]);

    const response = { record: { id: () => 'post-1', params: {} } };
    const result = await attachPostReviewData(pool)(response);

    const payload = JSON.parse(result.record.params[POST_REVIEW_WORKSPACE_PARAM]);
    assert.equal(payload.error, false);
    assert.equal(payload.post.typeLabel, 'Rescue');
  });

  it('never breaks the Post record page when review data fails', async () => {
    const failingPool = {
      query: async () => {
        throw new Error('relation does not exist');
      },
    };
    const response = { record: { id: () => 'post-1', params: {} } };
    const result = await attachPostReviewData(failingPool)(response);

    const payload = JSON.parse(result.record.params[POST_REVIEW_WORKSPACE_PARAM]);
    assert.equal(payload.error, true);
    assert.match(payload.message, /could not be loaded/i);
  });

  it('is a no-op without a query-capable pool or record id', async () => {
    const response = { record: { id: () => 'post-1', params: {} } };
    const withoutPool = await attachPostReviewData(undefined)(response);
    assert.equal(POST_REVIEW_WORKSPACE_PARAM in withoutPool.record.params, false);

    const withPool = await attachPostReviewData({ query: async () => ({ rows: [] }) })({ record: null });
    assert.equal(withPool.record, null);
  });

  it('serves another discussion page to authenticated administrators through a hidden API action', async () => {
    const pool = createMockPool(
      buildDiscussionHandlers({
        total: 12,
        topLevel: [commentRow({ id: 'c11' })],
      }),
    );
    const action = buildPostReviewActions(pool)[POST_REVIEW_DISCUSSION_ACTION];

    assert.equal(action.actionType, 'record');
    assert.equal(action.component, false);
    assert.equal(action.isVisible, false);
    assert.equal(action.isAccessible({ currentAdmin: { role: 'ADMIN' } }), true);
    assert.equal(action.isAccessible({ currentAdmin: { role: 'SUPER_ADMIN' } }), true);
    assert.equal(action.isAccessible({ currentAdmin: { role: 'VIEWER' } }), false);
    assert.equal(action.isAccessible({ currentAdmin: undefined }), false);

    const record = {
      id: () => 'post-1',
      toJSON: () => ({ params: {} }),
    };
    const result = await action.handler({ query: { page: '2' } }, {}, { record, currentAdmin: { id: 'admin-1' } });

    const discussion = JSON.parse(result.record.params[POST_REVIEW_DISCUSSION_PARAM]);
    assert.equal(discussion.page, 2);
    assert.equal(discussion.totalPages, 2);
  });
});

describe('Posts resource review workspace wiring', () => {
  const components = {
    ShortUuid: 'ShortUuidMock',
    ModerationAction: 'ModerationActionMock',
    PostReviewWorkspace: 'PostReviewWorkspaceMock',
  };

  it('puts the workspace property first on the record page and wires the custom component', () => {
    const resource = buildPostsResource(db, {}, components);
    const properties = resource.options.properties;

    assert.equal(properties[POST_REVIEW_WORKSPACE_PARAM].isDisabled, true);
    assert.equal(properties[POST_REVIEW_WORKSPACE_PARAM].components.show, 'PostReviewWorkspaceMock');
    assert.deepEqual(properties[POST_REVIEW_WORKSPACE_PARAM].isVisible, {
      list: false,
      show: true,
      edit: false,
      filter: false,
    });
    assert.equal(resource.options.showProperties[0], POST_REVIEW_WORKSPACE_PARAM);
    assert.ok(resource.options.showProperties.includes('description'));
  });

  it('omits the workspace property when the custom component is not registered', () => {
    const resource = buildPostsResource(db, {}, { ShortUuid: 'ShortUuidMock' });
    assert.equal(resource.options.properties[POST_REVIEW_WORKSPACE_PARAM], undefined);
    assert.equal(resource.options.showProperties.includes(POST_REVIEW_WORKSPACE_PARAM), false);
  });

  it('keeps the password-hash hook and adds the review data hook to the record page', async () => {
    const resource = buildPostsResource(db, {}, components);
    const showAfter = resource.options.actions.show.after;

    assert.ok(Array.isArray(showAfter));
    assert.equal(showAfter.length, 2);

    const response = {
      record: {
        params: { id: 'post-1' },
        populated: { creator_id: { params: { id: 'user-1', password_hash: 'leaked' } } },
      },
    };
    const stripped = showAfter[0](response);
    assert.equal(stripped.record.populated.creator_id.params.password_hash, undefined);
    const attached = await showAfter[1](stripped);
    assert.equal(POST_REVIEW_WORKSPACE_PARAM in attached.record.params, false);

    assert.ok(resource.options.actions[POST_REVIEW_DISCUSSION_ACTION]);
    assert.equal(resource.options.actions[POST_REVIEW_DISCUSSION_ACTION].component, false);
  });
});
