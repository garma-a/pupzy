import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildProductPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    category: enumProperty(ENUMS.productCategory),
    condition: enumProperty(ENUMS.productCondition),
    price_amount: {},
    price_currency: {},
    is_free: {},
    open_to_offers: {},
  };

  attachShortUuid(properties, ['post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'product_posts', { name: 'Post Details', icon: 'Layers' }, properties, {
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: ['post_id', 'category', 'condition', 'is_free', 'price_amount', 'price_currency', 'open_to_offers'],
    showProperties: ['post_id', 'category', 'condition', 'is_free', 'price_amount', 'price_currency', 'open_to_offers'],
    filterProperties: ['post_id', 'category', 'condition', 'is_free', 'open_to_offers'],
  });
}
