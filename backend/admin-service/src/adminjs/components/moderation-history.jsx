import React from 'react';
const date = (value) => (value ? new Date(value).toLocaleString() : '—');
/** Same short timeline on a case and in the Post review workspace. */
export default function ModerationHistory({ entries, heading = 'History', testId = 'pupzy-case-history', headingId }) {
  return (
    <section className="pupzy-post-review-section" data-testid={testId} aria-label={heading}>
      <h2 id={headingId}>{heading}</h2>
      {entries.length ? (
        <ol className="pupzy-case-timeline">
          {entries.map((e) => (
            <li key={e.id}>
              <strong>{e.actionLabel}</strong>
              <span dir="auto">{e.adminName}</span>
              <time title={date(e.createdAt)}>{date(e.createdAt)}</time>
              {e.reason ? <p dir="auto">{e.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p>No moderation actions recorded.</p>
      )}
    </section>
  );
}
