import { ENUMS } from '../enums.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';

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

  return {
    resource: db.table('rescue_posts'),
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
    },
  };
}
