import React, { useEffect, useState } from 'react';

import { adminRootPath } from './list-return.js';
import ShowField from './show-field.jsx';

export default function PostMediaPreview(props) {
  const body = <PostMediaPreviewValue {...props} />;
  return props.where === 'show' ? <ShowField property={props.property}>{body}</ShowField> : body;
}

function PostMediaPreviewValue({ property, record, where }) {
  const rawUrl = record?.params?.[property?.path];
  const url = typeof rawUrl === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(rawUrl) ? rawUrl : null;
  const postId = record?.params?.post_id;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const root = adminRootPath();
  const stopRowNavigation = (event) => event.stopPropagation();

  return (
    <div data-testid="post-media-preview" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {url && !failed ? (
        <a
          className="pupzy-media-thumb"
          style={{ width: where === 'list' ? '40px' : '112px', maxWidth: '100%' }}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open full Post photo"
          onClick={stopRowNavigation}
        >
          <img src={url} alt="Post photo preview" loading="lazy" onError={() => setFailed(true)} />
        </a>
      ) : (
        <span className="pupzy-media-fallback" role="img" aria-label="Image unavailable">
          Image unavailable
        </span>
      )}
      {where !== 'list' && postId ? (
        <a
          data-testid="post-media-review-link"
          href={`${root}/resources/posts/records/${encodeURIComponent(postId)}/show`}
          onClick={stopRowNavigation}
        >
          Open Post for moderation
        </a>
      ) : null}
    </div>
  );
}
