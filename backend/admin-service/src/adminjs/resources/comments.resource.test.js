import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCommentsResource } from './comments.resource.js';
import { buildCommentActions } from '../actions/moderate-comment.actions.js';

describe('AdminJS Comments Resource & Actions (Ticket 09)', () => {
  const db = { table: (name) => ({ name }) };
  const pool = { query: async () => ({ rows: [] }) };
  const components = {
    ShortUuid: 'ShortUuidMock',
    ReferenceLink: 'ReferenceLinkMock',
    ModerationAction: 'ModerationActionMock',
  };

  it('builds comments resource with correct properties and actions', () => {
    const resource = buildCommentsResource(db, pool, components);

    assert.equal(resource.resource.name, 'comments');
    assert.deepEqual(resource.options.listProperties, [
      'text',
      'author_id',
      'post_id',
      'status',
      'open_reports',
      'images_count',
      'created_at',
    ]);
    assert.deepEqual(resource.options.filterProperties, ['status', 'post_id', 'author_id', 'created_at']);
    assert.ok(resource.options.actions.restoreComment, 'Must define restoreComment action');
    assert.ok(resource.options.actions.removeComment, 'Must define removeComment action');
    assert.equal(
      resource.options.actions.inspectMedia,
      undefined,
      'the Comment page shows images and reports itself, so there is no separate Inspect Media action',
    );
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

  it('shows the evidence first on the Comment page and keeps the text in it', () => {
    const resource = buildCommentsResource(db, pool, { ...components, CommentEvidence: 'EvidenceMock' });
    assert.equal(resource.options.showProperties[0], 'comment_evidence');
    assert.equal(resource.options.properties.comment_evidence.components.show, 'EvidenceMock');
    assert.equal(resource.options.showProperties.includes('text'), false);
    const plain = buildCommentsResource(db, pool, components);
    assert.equal(
      plain.options.showProperties.includes('text'),
      true,
      'without the component the plain text field stays',
    );
  });

  describe('hiding a Comment from its page or its report', () => {
    const { hideComment, hideCommentImages, removeComment } = buildCommentActions(pool, components.ModerationAction);

    it('offers Hide Comment only for visible comments and Hide Comment Images only for active ones', () => {
      const at = (status) => ({ record: { params: { status } } });
      assert.equal(hideComment.component, 'ModerationActionMock');
      assert.deepEqual(
        ['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'DELETED', 'REMOVED'].map((status) => hideComment.isVisible(at(status))),
        [true, true, false, false, false],
      );
      assert.deepEqual(
        ['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'REMOVED'].map((status) => hideCommentImages.isVisible(at(status))),
        [true, false, false, false],
      );
      assert.equal(removeComment.isVisible(at('HIDDEN')), true);
      assert.equal(removeComment.isVisible(at('REMOVED')), false);
    });
  });
});
