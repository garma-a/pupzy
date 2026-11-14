import React from 'react';
import { StatusBadge } from './status-badge-component.jsx';
import { clinicListValues } from './clinic-list.js';

export default function ClinicList({ property, record }) {
  const params = record.params;
  const values = clinicListValues(params);
  if (property.path === 'is_active') return <StatusBadge value={values.status} label={values.statusLabel} />;
  if (property.path === 'phone_number')
    return values.phone ? <span dir="auto">{values.phone}</span> : <StatusBadge value="PENDING" label="No phone" />;
  if (property.path === 'name_arabic')
    return (
      <span className="pupzy-clinic-arabic" dir="rtl" title={params.name_arabic}>
        {params.name_arabic || '—'}
      </span>
    );
  return (
    <span className="pupzy-clinic-address" title={values.addresses.join('\n')}>
      {values.addresses.length
        ? values.addresses.map((address, index) => (
            <span key={index} dir="auto">
              {address}
            </span>
          ))
        : '—'}
    </span>
  );
}
