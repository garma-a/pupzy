import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildAdoptionPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    pet_name: {},
    species: enumProperty(ENUMS.speciesType),
    gender: enumProperty(ENUMS.genderType),
    breed: {},
    age_value: {},
    age_unit: enumProperty(ENUMS.ageUnit),
    vaccinated: {},
    neutered: {},
    space_requirement: enumProperty(ENUMS.spaceRequirement),
    prior_pet_experience_required: {},
    personality_tags: {},
    health_notes: {},
    additional_requirements: {},
    currently_with: {},
  };

  attachShortUuid(properties, ['post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'adoption_posts', { name: 'Post Details', icon: 'Layers' }, properties, {
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: [
      'post_id',
      'pet_name',
      'species',
      'gender',
      'breed',
      'vaccinated',
      'neutered',
      'space_requirement',
    ],
    showProperties: [
      'post_id',
      'pet_name',
      'species',
      'gender',
      'breed',
      'age_value',
      'age_unit',
      'vaccinated',
      'neutered',
      'space_requirement',
      'prior_pet_experience_required',
      'personality_tags',
      'health_notes',
      'additional_requirements',
      'currently_with',
    ],
    filterProperties: ['post_id', 'species', 'gender', 'breed', 'vaccinated', 'neutered', 'space_requirement'],
  });
}
