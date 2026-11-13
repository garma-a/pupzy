import React from 'react';

import ShowField from './show-field.jsx';

/** "All users", or the name of the one City an announcement went to. */
export default function AnnouncementAudience({ property, record, where }) {
  const params = record?.params ?? {};
  const label = params.audience === 'CITY' ? (params.audience_city_name ?? 'One City') : 'All users';
  const value = <span data-testid="announcement-audience">{label}</span>;
  return where === 'show' ? <ShowField property={property}>{value}</ShowField> : value;
}
