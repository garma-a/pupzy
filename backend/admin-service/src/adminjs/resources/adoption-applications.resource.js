import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildAdoptionApplicationsResource(db, components = {}) {
  const properties = {
    status: enumProperty(ENUMS.requestStatus, { isDisabled: true }),
    species_preference: enumProperty(ENUMS.speciesType, { isDisabled: true }),
    gender_preference: enumProperty(ENUMS.genderType, { isDisabled: true }),
    living_situation: enumProperty(ENUMS.livingSituation, { isDisabled: true }),
    breed_preference: { isDisabled: true },
    age_preference: { isDisabled: true },
    has_outdoor_access: { isDisabled: true },
    has_other_pets_at_home: { isDisabled: true },
    has_children_at_home: { isDisabled: true },
    hours_at_home_per_day: { isDisabled: true },
    previous_pet_experience: { isDisabled: true },
    why_adopt: { isDisabled: true },
    consent_home_visit: { isDisabled: true },
    can_provide_vet_reference: { isDisabled: true },
    responded_at: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'target_post_id', 'applicant_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'adoption_applications', { name: 'User Activity', icon: 'Users' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'target_post_id', 'applicant_id', 'status', 'living_situation', 'created_at'],
    showProperties: [
      'id',
      'target_post_id',
      'applicant_id',
      'status',
      'species_preference',
      'breed_preference',
      'age_preference',
      'gender_preference',
      'living_situation',
      'has_outdoor_access',
      'has_other_pets_at_home',
      'has_children_at_home',
      'hours_at_home_per_day',
      'previous_pet_experience',
      'why_adopt',
      'consent_home_visit',
      'can_provide_vet_reference',
      'responded_at',
      'created_at',
    ],
    filterProperties: [
      'status',
      'target_post_id',
      'applicant_id',
      'living_situation',
      'species_preference',
      'created_at',
    ],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
  });
}
