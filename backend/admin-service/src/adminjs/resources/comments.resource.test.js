import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCommentsResource } from './comments.resource.js';
import { buildCommentActions } from '../actions/moderate-comment.actions.js';

describe('AdminJS Comments Resource & Actions (Ticket 09)', () => {
  const db = { table: (name) => ({ name }) };
  const pool = { query: async () => ({ rows: [] }) };
  const components = {
    ShortUuid: 'ShortUuidMock',
    ModerationAction: 'ModerationActionMock',
  };

  it('builds comments resource with correct properties and actions', () => {
    const resource = buildCommentsResource(db, pool, components);

    assert.equal(resource.resource.name, 'comments');
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'post_id',
      'author_id',
      'status',
      'reply_count',
      'boost_count',
      'created_at',
    ]);
    assert.deepEqual(resource.options.filterProperties, ['status', 'post_id', 'author_id', 'created_at']);
    assert.ok(resource.options.actions.restoreComment, 'Must define restoreComment action');
    assert.ok(resource.options.actions.removeComment, 'Must define removeComment action');
    assert.ok(resource.options.actions.inspectMedia, 'Must define inspectMedia action');
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
  });

  describe('Comment moderation action visibility and validation', () => {
    const actions = buildCommentActions(pool, components.ModerationAction);

    it('restoreComment is visible only for IMAGE_HIDDEN or HIDDEN comments', () => {
      const { restoreComment } = actions;
      assert.equal(restoreComment.isVisible({ record: { params: { status: 'ACTIVE' } } }), false);
      assert.equal(restoreComment.isVisible({ record: { params: { status: 'DELETED' } } }), false);
      assert.equal(restoreComment.isVisible({ record: { params: { status: 'REMOVED' } } }), false);
      assert.equal(restoreComment.isVisible({ record: { params: { status: 'IMAGE_HIDDEN' } } }), true);
      assert.equal(restoreComment.isVisible({ record: { params: { status: 'HIDDEN' } } }), true);
    });

    it('inspectMedia is visible for ACTIVE, IMAGE_HIDDEN, and HIDDEN comments', () => {
      const { inspectMedia } = actions;
      assert.equal(inspectMedia.isVisible({ record: { params: { status: 'ACTIVE' } } }), true);
      assert.equal(inspectMedia.isVisible({ record: { params: { status: 'IMAGE_HIDDEN' } } }), true);
      assert.equal(inspectMedia.isVisible({ record: { params: { status: 'HIDDEN' } } }), true);
      assert.equal(inspectMedia.isVisible({ record: { params: { status: 'DELETED' } } }), false);
      assert.equal(inspectMedia.isVisible({ record: { params: { status: 'REMOVED' } } }), false);
    });

    it('inspectMedia handler queries media and reports without exposing public URLs', async () => {
      const mockMedia = [
        { id: 'm1', storage_key: 'comments/c1/1.webp', display_order: 0 },
        { id: 'm2', storage_key: 'comments/c1/2.webp', display_order: 1 },
      ];
      const mockReports = [
        { id: 'r1', reporter_id: 'u1', reason: 'INAPPROPRIATE_CONTENT', reviewed_at: null },
      ];
      const testPool = {
        query: async (sql) => {
          if (sql.includes('comment_media')) return { rows: mockMedia };
          if (sql.includes('comment_reports')) return { rows: mockReports };
          return { rows: [] };
        },
      };
      const testActions = buildCommentActions(testPool, components.ModerationAction);
      const mockRecord = {
        id: () => 'comment-1',
        params: { id: 'comment-1', status: 'IMAGE_HIDDEN' },
        toJSON: (admin) => ({ id: 'comment-1', status: 'IMAGE_HIDDEN' }),
      };
      const result = await testActions.inspectMedia.handler(
        { method: 'get' },
        {},
        { record: mockRecord, currentAdmin: { id: 'admin-1', role: 'SUPERADMIN' } },
      );
      assert.deepEqual(result.media, mockMedia);
      assert.deepEqual(result.reports, mockReports);
      assert.equal(mockRecord.params.comment_media, JSON.stringify(mockMedia));
      assert.equal(mockRecord.params.comment_reports, JSON.stringify(mockReports));
    });

    it('removeComment is visible for all non-REMOVED statuses', () => {
      const { removeComment } = actions;
      assert.equal(removeComment.isVisible({ record: { params: { status: 'ACTIVE' } } }), true);
      assert.equal(removeComment.isVisible({ record: { params: { status: 'IMAGE_HIDDEN' } } }), true);
      assert.equal(removeComment.isVisible({ record: { params: { status: 'HIDDEN' } } }), true);
      assert.equal(removeComment.isVisible({ record: { params: { status: 'DELETED' } } }), true);
      assert.equal(removeComment.isVisible({ record: { params: { status: 'REMOVED' } } }), false);
    });
  });
});
