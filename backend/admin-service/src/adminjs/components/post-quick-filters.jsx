import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { queueHref } from '../dashboard/work-queues.js';
import { adminRootPath } from './list-return.js';
export default function PostQuickFilters({ queues }) {
  const location = useLocation(),
    navigate = useNavigate();
  const current = new URLSearchParams(location.search);
  return (
    <nav className="pupzy-post-queues" aria-label="Post queues">
      {queues.map((queue) => {
        const query = new URLSearchParams(queueHref(queue, adminRootPath()).split('?')[1]);
        if (queue.id === 'rescue') {
          query.set('sortBy', 'urgency');
          query.set('direction', 'asc');
        }
        const href = `${adminRootPath()}/resources/posts?${query.toString()}`;
        const active = Object.entries(queue.filters).every(([key, value]) => current.get(`filters.${key}`) === value);
        return (
          <a
            key={queue.id}
            href={href}
            data-testid={`pupzy-post-queue-${queue.id}`}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                navigate(href);
              }
            }}
          >
            {queue.label} <span>{queue.count.toLocaleString()}</span>
          </a>
        );
      })}
    </nav>
  );
}
