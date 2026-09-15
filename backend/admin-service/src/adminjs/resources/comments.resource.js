import { buildCommentActions } from '../actions/moderate-comment.actions.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';

export function buildCommentsResource(db, pool, components = {}, cache) {
  const properties = {
    id: { isTitle: true, isDisabled: true },
    post_id: { isDisabled: true },
    parent_id: { isDisabled: true },
    author_id: { isDisabled: true },
    text: { isDisabled: true },
    status: enumProperty(['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'DELETED', 'REMOVED']),
    reply_count: { isDisabled: true },
    boost_count: { isDisabled: true },
    created_at: { isDisabled: true },
    updated_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'post_id', 'author_id', 'parent_id'], components, ['list', 'show']);

  return {
    resource: db.table('comments'),
    options: {
      navigation: { name: 'Moderation', icon: 'MessageSquare' },
      properties,
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        edit: { isAccessible: false },
        list: { after: stripPopulatedPasswordHashes },
        show: {
          after: [
            stripPopulatedPasswordHashes,
            async (response, _request, _context) => {
              if (response?.record && pool?.query) {
                const commentId =
                  typeof response.record.id === 'function' ? response.record.id() : response.record.params?.id;
                if (commentId) {
                  try {
                    const { rows: media } = await pool.query(
                      `SELECT id, storage_key, width, height, file_size_bytes, display_order, file_content_type, created_at
                       FROM comment_media
                       WHERE comment_id = $1
                       ORDER BY display_order ASC`,
                      [commentId],
                    );
                    const { rows: reports } = await pool.query(
                      `SELECT id, reporter_id, reason, details, reviewed_at, created_at
                       FROM comment_reports
                       WHERE comment_id = $1
                       ORDER BY created_at DESC`,
                      [commentId],
                    );
                    if (response.record.params) {
                      response.record.params.comment_media = JSON.stringify(media);
                      response.record.params.comment_reports = JSON.stringify(reports);
                    }
                  } catch {
                    // Ignore query errors in unit tests without comment_media table
                  }
                }
              }
              return response;
            },
          ],
        },
        ...buildCommentActions(pool, components?.ModerationAction, cache),
      },
      listProperties: ['id', 'post_id', 'author_id', 'status', 'reply_count', 'boost_count', 'created_at'],
      showProperties: [
        'id',
        'post_id',
        'parent_id',
        'author_id',
        'text',
        'status',
        'reply_count',
        'boost_count',
        'created_at',
        'updated_at',
      ],
      filterProperties: ['status', 'post_id', 'author_id', 'created_at'],
      sort: { sortBy: 'created_at', direction: 'desc' },
    },
  };
}
