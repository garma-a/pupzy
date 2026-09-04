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
