import React from 'react';
import { OriginalRecordsTable } from 'adminjs';

import { rememberListSearch } from './list-return.js';

export default function ScrollableRecordsTable(props) {
  const resourceLabel = props.resource?.name ?? 'Resource';
  const resourceId = props.resource?.id;

  const rememberReturnSearch = (event) => {
    const row = event.target?.closest?.('tr[data-id]');
    if (!row || !resourceId || typeof window === 'undefined') return;
    rememberListSearch(resourceId, window.location.search);
  };

  return (
    <div
      className="pupzy-table-scroll"
      role="region"
      aria-label={`${resourceLabel} table`}
      tabIndex={0}
      onClickCapture={rememberReturnSearch}
    >
      <OriginalRecordsTable {...props} />
    </div>
  );
}
