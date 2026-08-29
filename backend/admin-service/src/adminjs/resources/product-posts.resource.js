import { ENUMS } from '../enums.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';

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

  return {
    resource: db.table('product_posts'),
    options: {
      navigation: { name: 'Post Details', icon: 'Layers' },
      properties,
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
        edit: { after: stripPopulatedPasswordHashes },
      },
      listProperties: [
        'post_id',
        'category',
        'condition',
        'is_free',
        'price_amount',
        'price_currency',
        'open_to_offers',
      ],
      showProperties: [
        'post_id',
        'category',
        'condition',
        'is_free',
        'price_amount',
        'price_currency',
        'open_to_offers',
      ],
      filterProperties: ['post_id', 'category', 'condition', 'is_free', 'open_to_offers'],
    },
  };
}
