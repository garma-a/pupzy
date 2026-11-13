import React, { useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';

import AnnouncementCard from './announcement-card.jsx';
import { RecordLink } from './record-link.jsx';
import { StateTag } from './record-status-component.jsx';

const api = new ApiClient();
const POLL_MS = 5000;
const UNFINISHED = new Set(['PENDING', 'SENDING']);

const format = (value) => (value === undefined || value === null ? '—' : Number(value).toLocaleString('en-US'));

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

function Stat({ label, value, testId, hint }) {
  return (
    <div className="pupzy-announcement-stat" data-testid={testId}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="pupzy-announcement-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Announcement detail: status and counts (refreshing itself while the
 * background fan-out is still running), the audience and both texts as
 * notification cards.
 */
export default function AnnouncementShow({ record: initialRecord, resource }) {
  const [record, setRecord] = useState(initialRecord);
  useEffect(() => setRecord(initialRecord), [initialRecord]);

  const params = record?.params ?? {};
  const unfinished = UNFINISHED.has(params.status);

  useEffect(() => {
    if (!unfinished) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await api.recordAction({
          resourceId: resource.id,
          recordId: record.id,
          actionName: 'show',
        });
        if (response.data?.record) setRecord(response.data.record);
      } catch {
        // Keep showing the last figures; the next tick tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [unfinished, resource.id, record?.id]);

  const sender = record?.populated?.sent_by_admin_id;
  const expected = Number(params.expected_recipients ?? 0);
  const delivered = Number(params.in_app_count ?? 0);
  const percent =
    expected > 0 ? Math.min(100, Math.round((delivered / expected) * 100)) : params.status === 'SENT' ? 100 : 0;
  const audience = params.audience === 'CITY' ? (params.audience_city_name ?? 'One City') : 'All users';

  return (
    <div className="pupzy-announcement" data-testid="announcement-show" data-status={params.status}>
      <header className="pupzy-announcement-header pupzy-announcement-show-header">
        <div>
          <h2>{params.title_en}</h2>
          <p dir="rtl" lang="ar" className="pupzy-arabic pupzy-announcement-subtitle">
            {params.title_ar}
          </p>
        </div>
        <span data-testid="announcement-status">
          <StateTag value={params.status} />
        </span>
      </header>

      {unfinished ? (
        <div className="pupzy-card pupzy-announcement-progress" data-testid="announcement-progress">
          <div
            className="pupzy-announcement-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="In-app notifications created"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>
            {params.status === 'PENDING'
              ? 'Queued. The backend starts delivering it within about a minute.'
              : `Delivering in the background: ${format(delivered)} of ${format(expected)} in-app notifications created.`}{' '}
            This page updates itself.
          </p>
        </div>
      ) : null}
      {params.status === 'FAILED' ? (
        <div className="pupzy-card pupzy-announcement-failure" role="alert" data-testid="announcement-failure">
          <strong>Delivery stopped.</strong> {params.failure_reason ?? 'No reason was recorded.'} Notifications already
          created stay delivered.
        </div>
      ) : null}

      <dl className="pupzy-announcement-stats">
        <Stat
          label="Recipients"
          value={format(expected)}
          testId="announcement-stat-recipients"
          hint="confirmed at send"
        />
        <Stat label="In-app" value={format(delivered)} testId="announcement-stat-in-app" hint="notifications created" />
        <Stat label="Push queued" value={format(params.push_intent_count)} testId="announcement-stat-push-queued" />
        <Stat
          label="Push delivered"
          value={format(params.push_delivered ?? 0)}
          testId="announcement-stat-push-delivered"
        />
        <Stat label="Push waiting" value={format(params.push_pending ?? 0)} testId="announcement-stat-push-waiting" />
        <Stat
          label="Push skipped"
          value={format(params.push_suppressed ?? 0)}
          testId="announcement-stat-push-skipped"
          hint="turned off since"
        />
        <Stat label="Push failed" value={format(params.push_failed ?? 0)} testId="announcement-stat-push-failed" />
      </dl>

      <section className="pupzy-card pupzy-announcement-panel" aria-label="Details">
        <dl className="pupzy-announcement-facts">
          <Fact label="Sent by">
            {sender?.id ? (
              <RecordLink
                resourceId="admin_users"
                recordId={sender.id}
                title={sender.params?.full_name ?? sender.params?.email ?? 'Admin'}
              />
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Sent">{formatDateTime(params.created_at)}</Fact>
          <Fact label="Audience">
            <span data-testid="announcement-audience">{audience}</span>
          </Fact>
          <Fact label="Audience frozen at">{formatDateTime(params.audience_cutoff_at)}</Fact>
          <Fact label="Delivery started">{formatDateTime(params.started_at)}</Fact>
          <Fact label="Delivery finished">{formatDateTime(params.completed_at)}</Fact>
        </dl>
      </section>

      <div className="pupzy-announcement-previews">
        <AnnouncementCard
          language="en"
          title={params.title_en}
          body={params.body_en}
          caption="English"
          testId="announcement-card-en"
        />
        <AnnouncementCard
          language="ar"
          title={params.title_ar}
          body={params.body_ar}
          caption="Arabic"
          testId="announcement-card-ar"
        />
      </div>
    </div>
  );
}
