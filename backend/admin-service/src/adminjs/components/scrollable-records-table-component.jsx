import React from 'react';
import { OriginalRecordsTable } from 'adminjs';

export default function ScrollableRecordsTable(props) {
  const resourceLabel = props.resource?.name ?? 'Resource';

  return (
    <div className="pupzy-table-scroll" role="region" aria-label={`${resourceLabel} table`} tabIndex={0}>
      <OriginalRecordsTable {...props} />
    </div>
  );
}
