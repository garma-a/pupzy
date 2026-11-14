import React from 'react';
import { RecordLink } from './record-link.jsx';
import { StatusBadge } from './status-badge-component.jsx';
export default function DefaultListProperty({ property, record, resource }) {
  const raw = record?.params?.[property.path];
  const option = property.availableValues?.find((entry) => String(entry.value) === String(raw));
  if (raw && (property.isTitle || (resource.id === 'comments' && property.path === 'text')))
    return <RecordLink resourceId={resource.id} recordId={record.id} title={String(raw)} />;
  if (option) return <StatusBadge value={raw} label={option.label} />;
  return (
    <span dir="auto" title={raw == null ? '' : String(raw)}>
      {raw == null || raw === '' ? '—' : String(raw)}
    </span>
  );
}
