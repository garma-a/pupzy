import React from 'react';
import { useNavigate } from 'react-router';

import { adminRootPath, inboxBackHref } from './list-return.js';

/** "Back to inbox", to the same filter and page the case was opened from. */
export function BackToInbox() {
  const navigate = useNavigate();
  const href = inboxBackHref(typeof window === 'undefined' ? '' : window.location.search, adminRootPath());
  const onClick = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a className="pupzy-back-link" href={href} onClick={onClick} data-testid="pupzy-back-to-inbox">
      <span aria-hidden="true">←</span> Back to inbox
    </a>
  );
}

export default BackToInbox;
