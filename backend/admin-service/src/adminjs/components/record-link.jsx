import React from 'react';
import { ViewHelpers } from 'adminjs';
import { useNavigate } from 'react-router';

import { Avatar } from './avatar-component.jsx';

const helpers = new ViewHelpers();

/**
 * A link to a record's show page. A plain click navigates inside the admin app
 * and never reaches a list row's own click handler; modified clicks keep their
 * browser meaning. A user shows a small avatar beside the name.
 */
export function RecordLink({
  resourceId,
  recordId,
  title,
  pictureUrl,
  showAvatar = false,
  testId = 'pupzy-reference-link',
}) {
  const navigate = useNavigate();
  const href = helpers.recordActionUrl({ resourceId, recordId, actionName: 'show' });
  const onClick = (event) => {
    event.stopPropagation();
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigate(href);
    }
  };
  return (
    <a
      href={href}
      onClick={onClick}
      data-testid={testId}
      data-reference-resource={resourceId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        color: '#A84E1F',
        textDecoration: 'none',
      }}
    >
      {showAvatar ? <Avatar name={title} src={pictureUrl} size={28} /> : null}
      <span
        dir="auto"
        title={title}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 'var(--pupzy-reference-width, 260px)',
        }}
      >
        {title}
      </span>
    </a>
  );
}

export default RecordLink;
