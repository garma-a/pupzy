import { attachShortUuid, buildReadOnlyResource, stripPopulatedPasswordHashes } from './resource-helpers.js';

export function buildPostUpvotesResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true },
    user_id: {},
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['post_id', 'user_id'], components, ['list', 'show']);

  return buildReadOnlyResource(
    db,
    'post_upvotes',
    {
      name: 'Engagement',
      icon: 'Activity',
    },
    properties,
    {
      sort: { sortBy: 'created_at', direction: 'desc' },
      listProperties: ['post_id', 'user_id', 'created_at'],
      showProperties: ['post_id', 'user_id', 'created_at'],
      filterProperties: ['post_id', 'user_id', 'created_at'],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}
