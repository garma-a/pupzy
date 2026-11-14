import React, { useEffect, useState } from 'react';
import { Avatar } from './avatar-component.jsx';
export function Thumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.thumbnailUrl]);
  if (item.avatar) return <Avatar name={item.avatar.name} src={item.avatar.pictureUrl} size={40} />;
  if (item.thumbnailUrl && !failed) {
    return (
      <img
        className="pupzy-case-thumb"
        src={item.thumbnailUrl}
        alt={`Photo for ${item.title}`}
        loading="lazy"
        width="40"
        height="40"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="pupzy-case-thumb pupzy-case-thumb-empty" role="img" aria-label="No photo">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m21 16-5-5-8 8" />
      </svg>
    </span>
  );
}
