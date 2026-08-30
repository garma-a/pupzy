import { attachShortUuid, buildReadOnlyResource, stripPopulatedPasswordHashes } from './resource-helpers.js';

export function buildPostMediaResource(db, components = {}) {
  const properties = {
    id: { isTitle: true, isDisabled: true },
    post_id: {},
    cloudflare_storage_key: { isDisabled: true },
    public_url: { isDisabled: true },
    display_order: {},
    file_content_type: { isDisabled: true },
    file_size_bytes: { isDisabled: true },
    width: { isDisabled: true },
    height: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'post_media', { name: 'Post Details', icon: 'Image' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: ['id', 'post_id', 'display_order', 'file_content_type', 'file_size_bytes', 'created_at'],
    showProperties: [
      'id',
      'post_id',
      'public_url',
      'cloudflare_storage_key',
      'display_order',
      'file_content_type',
      'file_size_bytes',
      'width',
      'height',
      'created_at',
    ],
    filterProperties: ['id', 'post_id', 'file_content_type', 'created_at'],
  });
}
