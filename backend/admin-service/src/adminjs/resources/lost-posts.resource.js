import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildLostPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    report_type: enumProperty(ENUMS.lostFoundType),
    species: enumProperty(ENUMS.speciesType),
    current_condition: enumProperty(ENUMS.foundAnimalCondition),
    pet_name: {},
    breed: {},
    color_and_markings: {},
    has_collar_with_identification_tag: {},
    circumstances: {},
    date_last_seen: {},
    date_found: {},
    has_medical_needs: {},
    is_elderly_or_very_young: {},
    last_seen_near_hazard: {},
    is_currently_safe_with_reporter: {},
  };

  attachShortUuid(properties, ['post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'lost_posts', { name: 'Post Details', icon: 'Layers' }, properties, {
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: [
      'post_id',
      'report_type',
      'species',
      'pet_name',
      'breed',
      'current_condition',
      'is_currently_safe_with_reporter',
    ],
    showProperties: [
      'post_id',
      'report_type',
      'species',
      'pet_name',
      'breed',
      'color_and_markings',
      'has_collar_with_identification_tag',
      'current_condition',
      'is_currently_safe_with_reporter',
      'date_last_seen',
      'date_found',
      'has_medical_needs',
      'is_elderly_or_very_young',
      'last_seen_near_hazard',
      'circumstances',
    ],
    filterProperties: [
      'post_id',
      'report_type',
      'species',
      'pet_name',
      'breed',
      'current_condition',
      'is_currently_safe_with_reporter',
      'date_last_seen',
      'date_found',
    ],
  });
}
