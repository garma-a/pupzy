import React from 'react';
import { ValueGroup } from '@adminjs/design-system';
import { useTranslation } from 'adminjs';

/** Muted dash AdminJS-style show pages use for an empty value. */
export function EmptyValue() {
  return <span style={{ color: '#B8A499' }}>—</span>;
}

/**
 * A labelled row on a show page. A custom component replaces AdminJS's own
 * row, so without this its value would have no label.
 */
export default function ShowField({ property, children }) {
  const { translateProperty } = useTranslation();
  return (
    <ValueGroup label={translateProperty(property?.label ?? property?.path, property?.resourceId)}>
      {children}
    </ValueGroup>
  );
}
