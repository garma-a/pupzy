import React from 'react';
import { ValueGroup } from '@adminjs/design-system';
import { useTranslation } from 'adminjs';

import { StatusBadge } from './status-badge-component.jsx';
import { EmptyValue } from './show-field.jsx';

function startCase(value) {
  const words = String(value).replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Replaces AdminJS's default show row so an empty value reads "—" instead of a
 * blank gap that looks like a missing field.
 */
export default function DefaultShowProperty({ property, record }) {
  const { translateProperty, tl } = useTranslation();
  const raw = record?.params?.[property.path];
  const label = translateProperty(property.label, property.resourceId);
  if (raw === undefined || raw === null || raw === '') {
    return (
      <ValueGroup label={label}>
        <EmptyValue />
      </ValueGroup>
    );
  }
  // eslint-disable-next-line eqeqeq
  const option = property.availableValues?.find((candidate) => candidate.value == raw);
  if (option) {
    const optionLabel = option.label || raw;
    return (
      <ValueGroup label={label}>
        <StatusBadge value={raw}>
          {tl(`${property.propertyPath}.${optionLabel}`, property.resourceId, { defaultValue: startCase(optionLabel) })}
        </StatusBadge>
      </ValueGroup>
    );
  }
  return (
    <ValueGroup label={label}>
      <span dir="auto">{String(raw)}</span>
    </ValueGroup>
  );
}
