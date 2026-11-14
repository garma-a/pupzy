import React, { useEffect, useState } from 'react';

import { initials } from '../reference-title.js';

/**
 * Small round profile picture with an initials fallback for a missing or
 * broken image. Shared by `ReferenceLink` and the user pages.
 */
export function Avatar({ name, src, size = 24 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = typeof src === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(src) && !failed;
  const box = {
    width: size,
    height: size,
    minWidth: size,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: '#E8DED5',
    color: '#8B6355',
    fontSize: Math.max(9, Math.round(size * 0.4)),
    fontWeight: 600,
    lineHeight: 1,
  };
  return showImage ? (
    <span style={box} data-testid="pupzy-avatar">
      <img
        src={src}
        alt=""
        loading="lazy"
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setFailed(true)}
      />
    </span>
  ) : (
    <span style={box} data-testid="pupzy-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export default Avatar;
