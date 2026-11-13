import React from 'react';

const format = (value) => Number(value).toLocaleString('en-US');

/** History column: push delivered out of push queued (queued only while the live figure is unavailable). */
export default function AnnouncementPush({ record }) {
  const params = record?.params ?? {};
  const queued = Number(params.push_intent_count ?? 0);
  const delivered = params.push_delivered;
  return (
    <span className="pupzy-announcement-count" data-testid="announcement-push">
      {delivered === undefined ? format(queued) : `${format(delivered)} / ${format(queued)}`}
    </span>
  );
}
