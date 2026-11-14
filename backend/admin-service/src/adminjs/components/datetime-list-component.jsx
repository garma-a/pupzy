import React from 'react';
import { relativeAge } from '../dashboard/inbox-format.js';
export default function DatetimeList({ property, record }) {
  const raw = record?.params?.[property.path];
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {relativeAge(raw)}
    </time>
  ) : (
    <span>—</span>
  );
}
