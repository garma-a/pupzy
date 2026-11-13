import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';
import { useLocation, useNavigate } from 'react-router';

import { Avatar } from '../components/avatar-component.jsx';
import { INBOX_RETURN_KEY, adminRootPath, rememberListSearch } from '../components/list-return.js';
import { caseHref, inboxSearch, relativeAge, reportCountLabel } from './inbox-format.js';
import { queueHref } from './work-queues.js';

const api = new ApiClient();

/** The five counts at the top; each one filters the list below. */
const TILES = [
  { kind: 'post_report', queue: 'open_post_reports', label: 'Open Post Reports' },
  { kind: 'comment_report', queue: 'open_comment_reports', label: 'Open Comment Reports' },
  { kind: 'account_report', queue: 'open_account_reports', label: 'Open Account Reports' },
  { kind: 'flagged', queue: 'flagged', label: 'Flagged posts' },
  { kind: 'pending', queue: 'pending_moderation', label: 'Pending review' },
];
const KIND_TONE = {
  post_report: 'warning',
  comment_report: 'warning',
  account_report: 'warning',
  flagged: 'danger',
  pending: 'warning',
};
const KINDS = new Set(TILES.map((tile) => tile.kind));

function readSearch(search) {
  const params = new URLSearchParams(search);
  const page = Number.parseInt(params.get('page'), 10);
  return {
    kind: KINDS.has(params.get('kind')) ? params.get('kind') : 'all',
    order: params.get('order') === 'newest' ? 'newest' : 'oldest',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const isPlainClick = (event) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function Thumbnail({ item }) {
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

function CaseRow({ item, search, rootPath, onOpen }) {
  const href = caseHref(item.target, `${rootPath}${search}`, rootPath);
  const exact = new Date(item.since).toLocaleString();
  return (
    <li className="pupzy-case" data-testid="pupzy-case" data-kind={item.kind}>
      <Thumbnail item={item} />
      <div className="pupzy-case-main">
        <div className="pupzy-case-meta">
          <span className="pupzy-status" data-tone={KIND_TONE[item.kind]} data-testid="pupzy-case-kind">
            {item.kindLabel}
          </span>
          <span className="pupzy-case-count" data-open={item.reportCount > 0} data-testid="pupzy-case-count">
            {reportCountLabel(item.reportCount)}
          </span>
        </div>
        <span className="pupzy-case-title" dir="auto" title={item.title}>
          {item.title}
        </span>
        {item.reasonLabel ? (
          <span className="pupzy-case-reason" data-testid="pupzy-case-reason" dir="auto">
            {item.reasonLabel}
          </span>
        ) : null}
      </div>
      <div className="pupzy-case-reporter">
        {item.reporter ? (
          <>
            <Avatar name={item.reporter.name} src={item.reporter.pictureUrl} size={28} />
            <span dir="auto" title={item.reporter.name}>
              {item.reporter.name}
            </span>
          </>
        ) : (
          <span className="pupzy-case-system" data-testid="pupzy-case-system">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <rect x="5" y="8" width="14" height="10" rx="2" />
              <path d="M12 4v4M9 12.5h.01M15 12.5h.01M9.5 15.5h5" />
            </svg>
            Automatic review
          </span>
        )}
      </div>
      <time className="pupzy-case-age" dateTime={new Date(item.since).toISOString()} title={exact}>
        {relativeAge(item.since)}
      </time>
      <a className="pupzy-case-open" href={href} data-testid="pupzy-case-open" onClick={(event) => onOpen(event, href)}>
        Open case
      </a>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="pupzy-cases" aria-hidden="true" data-testid="pupzy-cases-loading">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="pupzy-case pupzy-case-skeleton">
          <span className="pupzy-skeleton pupzy-skeleton-thumb" />
          <span className="pupzy-case-main">
            <span className="pupzy-skeleton pupzy-skeleton-line" style={{ width: '30%' }} />
            <span className="pupzy-skeleton pupzy-skeleton-line" style={{ width: '70%' }} />
          </span>
          <span className="pupzy-skeleton pupzy-skeleton-line" style={{ width: '60%' }} />
          <span className="pupzy-skeleton pupzy-skeleton-line" style={{ width: '50%' }} />
          <span className="pupzy-skeleton pupzy-skeleton-line" style={{ width: 80 }} />
        </li>
      ))}
    </ul>
  );
}

export default function Inbox() {
  const location = useLocation();
  const navigate = useNavigate();
  const rootPath = adminRootPath();
  const { kind, order, page } = readSearch(location.search);
  const canonicalSearch = inboxSearch({ kind, order, page });

  const [data, setData] = useState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);

  const load = useCallback(
    async (fresh = false) => {
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;
      setLoading(true);
      try {
        const params = { kind, order, page, ...(fresh ? { fresh: 'true' } : {}) };
        const response = await api.getDashboard({ params });
        if (latestRequest.current !== requestId) return;
        setData(response.data);
        setError('');
      } catch {
        if (latestRequest.current !== requestId) return;
        setError('The inbox could not be loaded.');
      } finally {
        if (latestRequest.current === requestId) setLoading(false);
      }
    },
    [kind, order, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next) => navigate({ pathname: rootPath, search: inboxSearch({ kind, order, page: 1, ...next }) });
  const openCase = (event, href) => {
    rememberListSearch(INBOX_RETURN_KEY, canonicalSearch);
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate(href);
    }
  };

  const queues = data?.queues ?? [];
  const countOf = (queueId) => Number(queues.find((queue) => queue.id === queueId)?.count ?? 0);
  const inbox = data?.inbox;
  const closedReports = queueHref({ resource: 'post_reports', filters: { review_state: 'REVIEWED' } }, rootPath);
  const activeTile = TILES.find((tile) => tile.kind === kind);
  const nothingAtAll = inbox && inbox.total === 0 && kind === 'all';

  return (
    <div className="pupzy-desk" data-testid="pupzy-inbox">
      <div className="pupzy-desk-header">
        <div>
          <h1>Inbox</h1>
          <p>Open cases that need a moderator, {order === 'oldest' ? 'oldest first' : 'newest first'}.</p>
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
        <div className="pupzy-desk-error" role="alert" data-testid="pupzy-inbox-error">
          <p>{data ? `${error} The last loaded inbox remains below.` : `${error} Retry to see the open cases.`}</p>
          <button data-variant="primary" disabled={loading} aria-busy={loading} onClick={() => void load(true)}>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}

      <div className="pupzy-tiles" role="group" aria-label="Filter the inbox" data-testid="pupzy-tiles">
        {TILES.map((tile) => {
          const active = kind === tile.kind;
          const count = countOf(tile.queue);
          return (
            <button
              key={tile.kind}
              type="button"
              className="pupzy-tile"
              aria-pressed={active}
              data-active={active}
              data-alert={count > 0}
              data-testid={`pupzy-tile-${tile.kind}`}
              onClick={() => go({ kind: active ? 'all' : tile.kind })}
            >
              <strong data-testid={`pupzy-tile-count-${tile.kind}`}>{data ? count.toLocaleString() : '–'}</strong>
              <span>{tile.label}</span>
            </button>
          );
        })}
      </div>

      <section aria-labelledby="pupzy-cases-heading" className="pupzy-cases-section">
        <div className="pupzy-cases-toolbar">
          <h2 id="pupzy-cases-heading" data-testid="pupzy-cases-heading">
            {activeTile ? activeTile.label : 'All open cases'}
            {data ? (
              <span className="pupzy-case-muted">
                {' '}
                · {(activeTile ? countOf(activeTile.queue) : (inbox?.total ?? 0)).toLocaleString()}
              </span>
            ) : null}
          </h2>
          <div className="pupzy-cases-controls">
            <button
              type="button"
              className="pupzy-link-button"
              aria-pressed={kind === 'all'}
              data-testid="pupzy-all-cases"
              onClick={() => go({ kind: 'all' })}
            >
              All cases
            </button>
            <div className="pupzy-segmented" role="group" aria-label="Sort order">
              {[
                ['oldest', 'Oldest first'],
                ['newest', 'Newest first'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={order === value}
                  data-testid={`pupzy-order-${value}`}
                  onClick={() => go({ order: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!inbox && loading ? <SkeletonRows /> : null}
        {inbox ? (
          <div aria-busy={loading} data-loading={loading}>
            {inbox.items.length ? (
              <ul className="pupzy-cases" data-testid="pupzy-cases">
                {inbox.items.map((item) => (
                  <CaseRow key={item.key} item={item} search={canonicalSearch} rootPath={rootPath} onOpen={openCase} />
                ))}
              </ul>
            ) : (
              <div className="pupzy-cases-empty" data-testid="pupzy-inbox-empty">
                <span aria-hidden="true">✓</span>
                {nothingAtAll ? (
                  <>
                    <h3>Nothing needs attention. Nice work.</h3>
                    <p>
                      Every report is closed and no post is waiting for review.{' '}
                      <a href={closedReports}>See closed reports</a>
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Nothing in this list.</h3>
                    <p>
                      <button className="pupzy-link-button" onClick={() => go({ kind: 'all' })}>
                        Show all open cases
                      </button>
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}

        {inbox && inbox.totalPages > 1 ? (
          <div className="pupzy-cases-pager" data-testid="pupzy-pager">
            <button
              disabled={inbox.page <= 1 || loading}
              onClick={() => go({ page: inbox.page - 1 })}
              data-testid="pupzy-page-previous"
            >
              Previous
            </button>
            <span>
              Page {inbox.page} of {inbox.totalPages}
            </span>
            <button
              disabled={inbox.page >= inbox.totalPages || loading}
              onClick={() => go({ page: inbox.page + 1 })}
              data-testid="pupzy-page-next"
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
