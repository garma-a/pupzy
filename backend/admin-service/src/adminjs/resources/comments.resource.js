import { listOnlyProperty } from '../review/list-summaries.js';
import { buildCommentActions } from '../actions/moderate-comment.actions.js';
import { COMMENT_EVIDENCE_PARAM, attachCommentEvidence } from '../review/comment-evidence.js';
import {
  attachReferenceLink,
  attachShortUuid,
  enumProperty,
  noDeleteActions,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildCommentsResource(db, pool, components = {}, cache) {
  const properties = {
    open_reports: listOnlyProperty(),
    images_count: listOnlyProperty(),
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

  const hasEvidence = Boolean(components?.CommentEvidence);
  if (hasEvidence) {
    properties[COMMENT_EVIDENCE_PARAM] = {
      isVisible: { list: false, show: true, edit: false, filter: false },
      isDisabled: true,
      components: { show: components.CommentEvidence },
    };
  }

  attachShortUuid(properties, ['id'], components, ['show']);
  attachReferenceLink(properties, ['post_id', 'author_id', 'parent_id'], components, ['list', 'show']);

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
          after: [stripPopulatedPasswordHashes, attachCommentEvidence(pool, { commentIdOf: (params) => params.id })],
        },
        ...buildCommentActions(pool, components?.ModerationAction, cache),
      },
      listProperties: ['text', 'author_id', 'post_id', 'status', 'open_reports', 'images_count', 'created_at'],
      showProperties: [
        ...(hasEvidence ? [COMMENT_EVIDENCE_PARAM] : []),
        'id',
        'post_id',
        'parent_id',
        'author_id',
        ...(hasEvidence ? [] : ['text']),
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
