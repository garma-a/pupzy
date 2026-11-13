import React from 'react';

import ShowField from './show-field.jsx';

const LABELS = {
  PENDING_AUTO_REVIEW: 'Pending review',
  IMAGE_HIDDEN: 'Image hidden',
  ACTION_TAKEN: 'Action taken',
  NO_ACTION: 'No action',
};
const POSITIVE = new Set([
  'ACTIVE',
  'CLEAN',
  'RESOLVED',
  'REUNITED',
  'ADOPTED',
  'SOLD',
  'ACCEPTED',
  'ACTION_TAKEN',
  'SENT',
]);
const ATTENTION = new Set(['PENDING', 'PENDING_AUTO_REVIEW', 'OPEN', 'URGENT', 'SENDING']);
const DANGER = new Set(['FLAGGED', 'BANNED', 'CRITICAL', 'FAILED']);

export function StateTag({ value, label: explicitLabel }) {
  if (value == null || value === '') return <span style={{ color: '#B8A499' }}>—</span>;
  const raw = String(value);
  const words = raw.replaceAll('_', ' ').toLowerCase();
  const label = explicitLabel ?? LABELS[raw] ?? words.charAt(0).toUpperCase() + words.slice(1);
  const tone = DANGER.has(raw) ? 'danger' : ATTENTION.has(raw) ? 'warning' : POSITIVE.has(raw) ? 'success' : 'neutral';
  return (
    <span className="pupzy-status" data-tone={tone}>
      {label}
    </span>
  );
}

export default function RecordStatus({ property, record, where }) {
  const tag = <StateTag value={record?.params?.[property.path]} />;
  return where === 'show' ? <ShowField property={property}>{tag}</ShowField> : tag;
}
