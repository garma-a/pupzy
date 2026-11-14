import React from 'react';
import {
  OriginalShow,
  ViewHelpers,
  buildActionClickHandler,
  useActionResponseHandler,
  useTranslation,
  useModal,
} from 'adminjs';
import { useLocation, useNavigate } from 'react-router';
import { reportReviewStatus } from '../report-status.js';
import { plainValue } from '../status-styles.js';
import { userDisplayName } from '../reference-title.js';
import { StatusBadge } from './status-badge-component.jsx';
import { BackToInbox } from './back-to-inbox.jsx';
import { RecordLink } from './record-link.jsx';
import ReferenceLink from './reference-link-component.jsx';
import ModerationHistory from './moderation-history.jsx';
import { Avatar } from './avatar-component.jsx';
import CommentEvidence, { ReportItem } from './comment-evidence-component.jsx';
import { MediaThumb, useMediaLightbox } from './media-lightbox.jsx';
import { adminRootPath, reportReviewHref } from './list-return.js';
const helpers = new ViewHelpers();
const ACTIONS = ['reviewWithNoAction', 'hideComment', 'removeComment', 'removePost', 'banAuthor', 'banUser'];
const LABELS = {
  reviewWithNoAction: 'Review with no action',
  hideComment: 'Hide comment',
  removeComment: 'Remove comment',
  removePost: 'Remove Post',
  banAuthor: 'Ban author',
  banUser: 'Ban account',
};
const TARGET_FIELDS = { post_reports: 'post_id', comment_reports: 'comment_id', account_reports: 'reported_user_id' };
const date = (value) => (value ? new Date(value).toLocaleString() : '—');
function Field({ label, children }) {
  return (
    <div className="pupzy-case-field">
      <dt>{label}</dt>
      <dd dir="auto">{children ?? '—'}</dd>
    </div>
  );
}
export default function ReportCase(props) {
  const { resource, record } = props;
  const params = record.params;
  const data = JSON.parse(params.report_case || 'null');
  const navigate = useNavigate(),
    location = useLocation();
  const actionResponseHandler = useActionResponseHandler(props.actionPerformed),
    translateFunctions = useTranslation(),
    modalFunctions = useModal();
  const { openMedia, dialog } = useMediaLightbox();
  if (!data)
    return (
      <div role="alert">
        Case evidence is unavailable. <BackToInbox />
      </div>
    );
  const state = reportReviewStatus({ reviewedAt: params.reviewed_at, reviewOutcome: params.review_outcome });
  const post = data.post,
    account = data.account;
  const accountName = account ? userDisplayName(account, account.id) : null;
  const actions = ACTIONS.map((name) => record.recordActions.find((a) => a.name === name)).filter(Boolean);
  const technical = {
    ...resource,
    showProperties: resource.showProperties.filter((p) =>
      [
        'id',
        TARGET_FIELDS[resource.id],
        'reporter_id',
        'source_id',
        'reviewed_at',
        'reviewed_by_admin_id',
        'review_outcome',
        'created_at',
      ].includes(p.propertyPath),
    ),
  };
  const onAction = (event, action) => {
    if (action.name === 'reviewWithNoAction') {
      event.preventDefault();
      navigate(reportReviewHref(resource.id, record.id, location.pathname + location.search, adminRootPath()));
      return;
    }
    buildActionClickHandler({
      action,
      params: { resourceId: resource.id, recordId: record.id },
      actionResponseHandler,
      navigate,
      location,
      translateFunctions,
      modalFunctions,
    })(event);
  };
  return (
    <main className="pupzy-case-view" data-testid="pupzy-case-view">
      <header>
        <BackToInbox />
        <h1>
          {
            { post_reports: 'Post report', comment_reports: 'Comment report', account_reports: 'Account report' }[
              resource.id
            ]
          }
        </h1>
      </header>
      <div className="pupzy-case-columns">
        <section className="pupzy-case-evidence" aria-label="Reported content">
          {post ? (
            <>
              <div className="pupzy-media-grid">
                {data.photos.map((item, index) => (
                  <MediaThumb
                    key={item.id}
                    item={item}
                    index={index}
                    total={data.photos.length}
                    description={`Post photo ${index + 1} of ${data.photos.length}`}
                    onOpen={(trigger) => openMedia(data.photos, index, trigger)}
                  />
                ))}
              </div>
              <h2 dir="auto">
                <RecordLink resourceId="posts" recordId={post.id} title={post.title} wrap />
              </h2>
              <div className="pupzy-discussion-meta">
                <StatusBadge value="CLOSED" label={post.typeLabel} />
                <StatusBadge value={post.status} label={post.statusLabel} />
                <StatusBadge value={post.moderationStatus} label={post.moderationLabel} />
              </div>
              <p dir="auto" className="pupzy-case-text">
                {post.text}
              </p>
              <dl>
                <Field label="Owner">
                  <RecordLink
                    resourceId="users"
                    recordId={post.owner.id}
                    title={post.owner.name}
                    pictureUrl={post.owner.pictureUrl}
                    showAvatar
                  />
                </Field>
                <Field label="City">{post.city}</Field>
                <Field label="Created">{date(post.createdAt)}</Field>
              </dl>
            </>
          ) : resource.id === 'comment_reports' ? (
            <CommentEvidence record={record} showReports={false} linkToComment />
          ) : account ? (
            <>
              <Avatar src={account.profile_picture_url} name={accountName} size={80} />
              <h2 dir="auto">
                <RecordLink resourceId="users" recordId={account.id} title={accountName} wrap />
              </h2>
              {account.full_name_arabic?.trim() && account.full_name_arabic.trim() !== accountName ? (
                <p dir="auto">{account.full_name_arabic}</p>
              ) : null}
              <dl>
                <Field label="Email">{account.email}</Field>
                <Field label="Joined">{date(account.created_at)}</Field>
                <Field label="Status">
                  <StatusBadge value={account.is_banned ? 'BANNED' : 'ACTIVE'} />
                </Field>
                <Field label="Posts">{account.post_count}</Field>
                <Field label="Open reports">{account.open_reports}</Field>
                <Field label="Past moderation actions">{account.past_actions}</Field>
              </dl>
              {params.source_id && record.populated?.source_id?.resourceId ? (
                <dl>
                  <Field label="Source content">
                    <ReferenceLink record={record} property={{ path: 'source_id' }} where="list" />
                  </Field>
                </dl>
              ) : null}
            </>
          ) : (
            <p>The reported content is no longer available.</p>
          )}
        </section>
        <aside className="pupzy-case-decision" aria-label="Report and actions">
          <dl>
            <Field label="Status">
              <div data-testid="pupzy-report-status">
                <StatusBadge value={state.state} label={state.label} />
                {params.reviewed_at ? (
                  <p>
                    Closed on {date(params.reviewed_at)}
                    {record.populated?.reviewed_by_admin_id
                      ? ` by ${record.populated.reviewed_by_admin_id.params?.full_name || record.populated.reviewed_by_admin_id.title}`
                      : ''}
                  </p>
                ) : null}
              </div>
            </Field>
            <Field label="Reason">{plainValue(params.reason)}</Field>
            <Field label="Details">
              <span dir="auto">{params.details || '—'}</span>
            </Field>
            <Field label="Reported by">
              <ReferenceLink record={record} property={{ path: 'reporter_id', reference: 'users' }} where="list" />
            </Field>
          </dl>
          <nav className="pupzy-case-actions" aria-label="Case actions">
            {actions.map((a) => (
              <a
                key={a.name}
                data-testid={`action-${a.name}`}
                className="pupzy-case-action"
                data-destructive={a.name !== 'reviewWithNoAction'}
                href={helpers.recordActionUrl({ resourceId: resource.id, recordId: record.id, actionName: a.name })}
                onClick={(e) => onAction(e, a)}
              >
                {LABELS[a.name]}
              </a>
            ))}
          </nav>
          <details className="pupzy-case-other">
            <summary>Other reports on this ({data.otherReportsTotal})</summary>
            {data.reports.length ? (
              <ul className="pupzy-report-list">
                {data.reports.map((report) => (
                  <ReportItem key={report.id} report={report} resourceId={resource.id} />
                ))}
              </ul>
            ) : (
              <p>No other reports.</p>
            )}
            {data.otherReportsTotal > data.reports.length ? (
              <a
                href={helpers.resourceActionUrl({
                  resourceId: resource.id,
                  actionName: 'list',
                  search: `?filters.${TARGET_FIELDS[resource.id]}=${encodeURIComponent(params[TARGET_FIELDS[resource.id]])}`,
                })}
              >
                View all reports
              </a>
            ) : null}
          </details>
          <ModerationHistory entries={data.history} />
        </aside>
      </div>
      <details className="pupzy-case-technical">
        <summary>Technical details</summary>
        <OriginalShow {...props} resource={technical} />
      </details>
      {dialog}
    </main>
  );
}
