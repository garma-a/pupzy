import React from 'react';
import { StatusBadge } from './status-badge-component.jsx';
export default function DefaultListProperty({ property, record }) {
  const raw = record?.params?.[property.path];
  const option = property.availableValues?.find((entry) => String(entry.value) === String(raw));
  if (option) return <StatusBadge value={raw} label={option.label} />;
  return (
    <span dir="auto" title={raw == null ? '' : String(raw)}>
      {raw == null || raw === '' ? '—' : String(raw)}
    </span>
  );
}
