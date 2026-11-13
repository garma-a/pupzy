import React from 'react';
import { ValueGroup, formatDateProperty } from '@adminjs/design-system';
import { useTranslation } from 'adminjs';

import { EmptyValue } from './show-field.jsx';

/** Date and time show row that reads "—" when the value is empty. */
export default function DefaultDatetimeShowProperty({ property, record }) {
  const { translateProperty } = useTranslation();
  const raw = record?.params?.[property.path];
  const date = raw ? new Date(raw) : null;
  const text = date && !Number.isNaN(date.getTime()) ? formatDateProperty(date, property.type) : '';
  return (
    <ValueGroup label={translateProperty(property.label, property.resourceId)}>{text || <EmptyValue />}</ValueGroup>
  );
}
