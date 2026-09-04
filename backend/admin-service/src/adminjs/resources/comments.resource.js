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
        show: { after: stripPopulatedPasswordHashes },
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
