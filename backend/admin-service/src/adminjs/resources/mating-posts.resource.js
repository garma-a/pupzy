import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildMatingPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    pet_name: {},
    species: enumProperty(ENUMS.speciesType),
    gender: enumProperty(ENUMS.genderType),
    breed: {},
    age_value: {},
    age_unit: enumProperty(ENUMS.ageUnit),
    is_purebred: {},
    has_pedigree_certificate: {},
    vaccinated: {},
    dewormed: {},
    terms_summary: {},
    mating_conditions: {},
  };

  attachShortUuid(properties, ['post_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'mating_posts', { name: 'Post Details', icon: 'Layers' }, properties, {
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
    listProperties: ['post_id', 'pet_name', 'species', 'gender', 'breed', 'is_purebred', 'has_pedigree_certificate'],
    showProperties: [
      'post_id',
      'pet_name',
      'species',
      'gender',
      'breed',
      'age_value',
      'age_unit',
      'is_purebred',
      'has_pedigree_certificate',
      'vaccinated',
      'dewormed',
      'terms_summary',
      'mating_conditions',
    ],
    filterProperties: [
      'post_id',
      'species',
      'gender',
      'breed',
      'is_purebred',
      'has_pedigree_certificate',
      'vaccinated',
      'dewormed',
    ],
  });
}
