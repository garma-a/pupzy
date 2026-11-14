import React from 'react';
import { Thumbnail } from './thumbnail.jsx';
import { RecordLink } from './record-link.jsx';
import { StatusBadge } from './status-badge-component.jsx';
export default function PostList({ record, property }) {
  const params = record.params;
  if (property.path === 'post_state')
    return (
      <span className="pupzy-post-state">
        <StatusBadge value={params.status} />
        <StatusBadge value={params.moderation_status} />
      </span>
    );
  return (
    <span className="pupzy-post-title">
      <Thumbnail item={{ title: params.title, thumbnailUrl: params.thumbnail }} />
      <RecordLink resourceId="posts" recordId={record.id} title={params.title} />
    </span>
  );
}
