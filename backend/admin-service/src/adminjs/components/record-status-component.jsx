import React from 'react';

const LABELS = {
  PENDING_AUTO_REVIEW: 'Pending review',
  IMAGE_HIDDEN: 'Image hidden',
  ACTION_TAKEN: 'Action taken',
  NO_ACTION: 'No action',
};
const POSITIVE = new Set(['ACTIVE', 'CLEAN', 'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'ACCEPTED', 'ACTION_TAKEN']);
const ATTENTION = new Set(['PENDING', 'PENDING_AUTO_REVIEW', 'OPEN', 'URGENT']);
const DANGER = new Set(['FLAGGED', 'BANNED', 'CRITICAL']);

export function StateTag({ value, label: explicitLabel }) {
  if (value == null || value === '') return <span>—</span>;
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

export default function RecordStatus({ property, record }) {
  return <StateTag value={record?.params?.[property.path]} />;
}
