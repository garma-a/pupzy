import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildRescuePostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    species: enumProperty(ENUMS.speciesType),
    reporter_role: enumProperty(ENUMS.reporterRole),
    is_life_threatening: {},
    has_visible_serious_injury: {},
    is_in_dangerous_location: {},
    can_animal_move_or_escape: {},
    condition_summary: {},
  };

  attachShortUuid(properties, ['post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'rescue_posts', { name: 'Post Details', icon: 'Layers' }, properties, {
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: ['post_id', 'species', 'reporter_role', 'is_life_threatening', 'condition_summary'],
    showProperties: [
      'post_id',
      'species',
      'reporter_role',
      'condition_summary',
      'is_life_threatening',
      'has_visible_serious_injury',
      'is_in_dangerous_location',
      'can_animal_move_or_escape',
    ],
    filterProperties: [
      'post_id',
      'species',
      'reporter_role',
      'is_life_threatening',
      'has_visible_serious_injury',
      'is_in_dangerous_location',
    ],
  });
}
