import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';
import { Loader } from '@adminjs/design-system';
import { queueHref } from './work-queues.js';

const api = new ApiClient();
const statLabels = [
  ['total_users', 'Total users'],
  ['banned_users', 'Banned users'],
  ['total_posts', 'Total Posts'],
  ['active_posts', 'Active Posts'],
  ['needs_review_posts', 'Needs review'],
  ['flagged_posts', 'Flagged'],
];
const ALERT_GROUPS = ['needs_review'];
const statusLabel = (value) =>
  ({ PENDING_AUTO_REVIEW: 'Pending review', FLAGGED: 'Flagged', CLEAN: 'Clean' })[value] ?? value;
const typeLabel = (value) => (value ? value.charAt(0) + value.slice(1).toLowerCase() : '');
function adminRootPath() {
  return (typeof window !== 'undefined' && window.REDUX_STATE?.paths?.rootPath) || '/admin';
}
function QueueButton({ queue, priority }) {
  const isAlert = ALERT_GROUPS.includes(queue.group) && queue.count > 0;
  return (
    <a
      href={queueHref(queue, adminRootPath())}
      className="pupzy-queue-button"
      data-testid={`pupzy-queue-${queue.id}`}
      data-alert={isAlert ? 'true' : 'false'}
      data-priority={priority ? 'true' : 'false'}
    >
      <span className="pupzy-queue-button-label">{queue.label}</span>
      <span className="pupzy-queue-button-meta">
        <span className="pupzy-queue-button-count" aria-label={`${queue.count} records`}>
          {queue.count.toLocaleString()}
        </span>
      </span>
    </a>
  );
}
function queueGroups(queues) {
  const groups = [];
  for (const queue of queues) {
    let group = groups.find((candidate) => candidate.id === queue.group);
    if (!group) {
      group = { id: queue.group, label: queue.groupLabel, queues: [] };
      groups.push(group);
    }
    group.queues.push(queue);
  }
  return groups;
}
export default function Dashboard() {
  const [data, setData] = useState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const response = await api.getDashboard(fresh ? { params: { fresh: 'true' } } : undefined);
      setData(response.data);
      setError('');
    } catch {
      setError('Dashboard data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data && error) {
    return (
      <div className="pupzy-desk pupzy-desk-unavailable">
        <h1>Moderation overview</h1>
        <div className="pupzy-desk-error" role="alert">
          <div>
            <h2>Overview unavailable</h2>
            <p>{error} Retry to see current Posts, reports and totals.</p>
          </div>
          <button data-variant="primary" disabled={loading} aria-busy={loading} onClick={() => void load(true)}>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="pupzy-desk-loading" role="status" aria-live="polite">
        <Loader />
        <p>Loading Pupzy moderation overview…</p>
      </div>
    );
  }
  const queues = data?.queues ?? [];
  const flaggedQueue = queues.find((queue) => queue.id === 'flagged');
  const priorityQueue = queues.find((queue) => queue.group === 'needs_review' && queue.count > 0);
  return (
    <div className="pupzy-desk">
      <div className="pupzy-desk-header">
        <div>
          <h1>Moderation overview</h1>
          <p>Start with open reports, then take a closer look at new Posts.</p>
        </div>
        <div className="pupzy-desk-refresh">
          <button
            className="pupzy-dashboard-refresh"
            data-variant="secondary"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void load(true)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M4 17v-5h5M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7" />
            </svg>
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>
          <span>
            Updated{' '}
            {data?.stats?.computedAt
              ? new Date(data.stats.computedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'just now'}
          </span>
        </div>
      </div>
      {error ? (
        <div className="pupzy-desk-error" role="alert">
          <p>{error} The last loaded overview remains below.</p>
          <button data-variant="primary" disabled={loading} aria-busy={loading} onClick={() => void load(true)}>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}
      <section className="pupzy-desk-queues" aria-labelledby="pupzy-queues-heading">
        <div className="pupzy-section-heading">
          <h2 id="pupzy-queues-heading">Work queues</h2>
        </div>
        <div className="pupzy-queue-groups" data-testid="pupzy-work-queues">
          {queueGroups(queues).map((group) => (
            <section key={group.id} className="pupzy-queue-group" data-testid={`pupzy-queue-group-${group.id}`}>
              <h3>{group.label}</h3>
              <div className="pupzy-queue-grid">
                {group.queues.map((queue) => (
                  <QueueButton key={queue.id} queue={queue} priority={priorityQueue?.id === queue.id} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <section className="pupzy-review-inbox" aria-labelledby="pupzy-inbox-heading">
        <div className="pupzy-inbox-heading">
          <div>
            <h2 id="pupzy-inbox-heading">Posts needing review</h2>
            <p>Open a Post to see its photos, discussion and reports.</p>
          </div>
          {flaggedQueue ? (
            <a
              href={queueHref(flaggedQueue, adminRootPath())}
              className="pupzy-inbox-link"
              data-testid="pupzy-view-all-flagged"
            >
              Flagged — needs review <span>{flaggedQueue.count.toLocaleString()}</span>
            </a>
          ) : null}
        </div>
        {data?.needsReview?.length ? (
          <div className="pupzy-inbox-table" data-testid="pupzy-needs-review-table">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Type</th>
                  <th>Moderation</th>
                  <th>Open reports</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.needsReview.map((post) => (
                  <tr key={post.id}>
                    <td>
                      <a
                        href={`${adminRootPath()}/resources/posts/records/${encodeURIComponent(post.id)}/show`}
                        title={post.title}
                      >
                        {post.title}
                      </a>
                    </td>
                    <td>{typeLabel(post.post_type)}</td>
                    <td>
                      <span
                        className="pupzy-status"
                        data-tone={post.moderation_status === 'FLAGGED' ? 'danger' : 'warning'}
                      >
                        {statusLabel(post.moderation_status)}
                      </span>
                    </td>
                    <td>
                      <span className="pupzy-report-count" data-open={Number(post.open_report_count ?? 0) > 0}>
                        {Number(post.open_report_count ?? 0)}
                      </span>
                    </td>
                    <td>
                      <time dateTime={post.created_at}>
                        {new Date(post.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pupzy-inbox-empty">
            <span aria-hidden="true">✓</span>
            <h3>Review queue clear</h3>
            <p>There are no active Posts awaiting review. Open a work queue to revisit earlier decisions.</p>
          </div>
        )}
      </section>
      <section className="pupzy-community-summary" aria-label="Community totals">
        <div className="pupzy-metric-grid">
          {statLabels.map(([key, label]) => {
            const count = Number(data?.stats?.[key] ?? 0);
            return (
              <div
                key={key}
                className="pupzy-card pupzy-stat"
                data-alert={['needs_review_posts', 'flagged_posts'].includes(key) && count > 0}
              >
                <span>{label}</span>
                <strong title={count.toLocaleString()}>{count.toLocaleString()}</strong>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
