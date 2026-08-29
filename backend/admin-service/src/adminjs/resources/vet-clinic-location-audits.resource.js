import { attachShortUuid, buildReadOnlyResource, stripPopulatedPasswordHashes } from './resource-helpers.js';

export function buildVetClinicLocationAuditsResource(db, components = {}) {
  const properties = {
    id: { isTitle: true, isDisabled: true },
    vet_clinic_id: {},
    admin_user_id: {},
    selected_city_id: {},
    nearest_city_id: {},
    coordinates: {
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    discrepancy_details: {
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    reason: {},
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'vet_clinic_id', 'admin_user_id'], components, ['list', 'show']);

  return buildReadOnlyResource(
    db,
    'vet_clinic_location_audits',
    { name: 'Admin Management', icon: 'Lock' },
    properties,
    {
      sort: { sortBy: 'created_at', direction: 'desc' },
      listProperties: [
        'id',
        'vet_clinic_id',
        'admin_user_id',
        'selected_city_id',
        'nearest_city_id',
        'reason',
        'created_at',
      ],
      showProperties: [
        'id',
        'vet_clinic_id',
        'admin_user_id',
        'selected_city_id',
        'nearest_city_id',
        'coordinates',
        'discrepancy_details',
        'reason',
        'created_at',
      ],
      filterProperties: ['vet_clinic_id', 'admin_user_id', 'selected_city_id', 'nearest_city_id', 'created_at'],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}
