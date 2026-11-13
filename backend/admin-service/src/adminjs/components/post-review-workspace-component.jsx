import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import { Badge, Box, Button, H3, H4, Link, Loader, MessageBox, Text } from '@adminjs/design-system';

import { filteredListBackLink, recallListSearch, reportReviewHref } from './list-return.js';
import { MediaThumb, useMediaLightbox } from './media-lightbox.jsx';
import { StateTag } from './record-status-component.jsx';

const api = new ApiClient();
const DISCUSSION_ACTION = 'postReviewDiscussion';

function adminRootPath() {
  return (typeof window !== 'undefined' && window.REDUX_STATE && window.REDUX_STATE.paths?.rootPath) || '/admin';
}

function adminResourceUrl(path) {
  return `${adminRootPath()}/resources/${path}`;
}

const COMMENT_BADGE_VARIANTS = {
  ACTIVE: 'success',
  IMAGE_HIDDEN: 'warning',
  HIDDEN: 'warning',
  DELETED: 'default',
  REMOVED: 'danger',
};

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function DiscussionItem({ item, onOpenMedia }) {
  return (
    <li
      className={`pupzy-discussion-item${item.isReply ? ' pupzy-discussion-reply' : ''}`}
      data-testid={item.isReply ? 'pupzy-discussion-reply' : 'pupzy-discussion-item'}
      data-status={item.status}
    >
      <div className="pupzy-discussion-meta">
        <Text fontWeight="bold">{item.authorName}</Text>
        <Text color="grey60" fontSize="sm">
          {formatDateTime(item.createdAt)}
        </Text>
        <Badge variant={COMMENT_BADGE_VARIANTS[item.status] ?? 'default'}>{item.statusLabel}</Badge>
        {item.boostCount > 0 ? (
          <Text color="grey60" fontSize="sm">
            {item.boostCount} {item.boostCount === 1 ? 'Boost' : 'Boosts'}
          </Text>
        ) : null}
      </div>
      <Text mt="sm" className="pupzy-discussion-text">
        {item.text}
      </Text>
      {item.attachments?.length ? (
        <div className="pupzy-media-grid pupzy-discussion-media">
          {item.attachments.map((attachment, attachmentIndex) => (
            <MediaThumb
              key={attachment.id}
              item={attachment}
              index={attachmentIndex}
              total={item.attachments.length}
              description={`Attachment on a Comment by ${item.authorName}`}
              onOpen={(trigger) => onOpenMedia(item.attachments, attachmentIndex, trigger)}
            />
          ))}
        </div>
      ) : null}
      {item.replies?.length ? (
        <ul className="pupzy-discussion-replies">
          {item.replies.map((reply) => (
            <DiscussionItem key={reply.id} item={reply} onOpenMedia={onOpenMedia} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ReportRow({ report, reviewHref, context }) {
  const closedOn = report.reviewedAt ? formatDateTime(report.reviewedAt) : null;
  return (
    <li className="pupzy-report-row">
      <div className="pupzy-discussion-meta">
        <Text fontWeight="bold">{report.reasonLabel}</Text>
        <Badge variant={report.isOpen ? 'warning' : 'default'} data-testid="pupzy-report-status">
          {report.statusLabel}
        </Badge>
      </div>
      {context ? (
        <Text color="grey60" fontSize="sm" mt="xs">
          {context}
        </Text>
      ) : null}
      {report.details ? <Text mt="xs">{report.details}</Text> : null}
      <div className="pupzy-discussion-meta pupzy-report-footer">
        <Text color="grey60" fontSize="sm">
          Reported by {report.reporterName} on {formatDateTime(report.createdAt)}
        </Text>
        {report.isOpen ? (
          <Link href={reviewHref} data-testid="pupzy-report-review-link">
            Review this report
          </Link>
        ) : (
          <Text color="grey60" fontSize="sm" data-testid="pupzy-report-closed-note">
            {closedOn ? `Closed on ${closedOn}` : 'Closed'}
            {report.reviewedByName ? ` by ${report.reviewedByName}` : ''}
          </Text>
        )}
      </div>
    </li>
  );
}

function EmptyState({ children }) {
  return (
    <Box className="pupzy-review-empty" p="lg">
      <Text color="grey60">{children}</Text>
    </Box>
  );
}

export default function PostReviewWorkspace({ resource, record }) {
  const review = useMemo(() => parseJson(record?.params?.post_review_workspace), [record]);
  const [discussion, setDiscussion] = useState(review?.discussion ?? null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState('');
  const { openMedia, dialog } = useMediaLightbox();
  const returnTo = typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`;

  useEffect(() => {
    setDiscussion(review?.discussion ?? null);
    setPageError('');
  }, [review]);

  const loadPage = useCallback(
    async (nextPage) => {
      if (!resource?.id || !record?.id || loadingPage) return;
      setLoadingPage(true);
      setPageError('');
      try {
        const response = await api.recordAction({
          resourceId: resource.id,
          recordId: record.id,
          actionName: DISCUSSION_ACTION,
          params: { page: nextPage },
        });
        const payload = parseJson(response?.data?.record?.params?.post_review_discussion);
        if (!payload) throw new Error('Discussion page payload missing');
        setDiscussion(payload);
      } catch {
        setPageError('The discussion page could not be loaded. Please try again.');
      } finally {
        setLoadingPage(false);
      }
    },
    [loadingPage, record?.id, resource?.id],
  );

  if (!review || review.error) {
    return (
      <Box className="pupzy-post-review" p="lg">
        <H3 mb="md">Review workspace</H3>
        <MessageBox variant="warning" message="The review workspace is unavailable for this record.">
          <Text>
            {review?.message ??
              'The workspace data could not be read. The record fields below remain available to review.'}
          </Text>
        </MessageBox>
      </Box>
    );
  }

  const post = review.post ?? {};
  const photos = review.photos ?? [];
  const reports = review.reports ?? {};
  const history = review.history ?? [];
  const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
  const backLink = filteredListBackLink(
    /(^\?|&)filters\./.test(currentSearch) ? currentSearch : recallListSearch('posts'),
    adminRootPath(),
  );

  return (
    <Box className="pupzy-post-review" p="xl" mb="xl" data-testid="pupzy-review-workspace">
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" style={{ gap: '12px' }}>
        <H3 style={{ margin: 0 }}>Review workspace</H3>
        {resource.id !== 'posts' && post.id ? (
          <Link
            href={adminResourceUrl(`posts/records/${encodeURIComponent(post.id)}/show`)}
            data-testid="pupzy-open-post"
          >
            Open Post for moderation
          </Link>
        ) : null}
        <Link href={backLink.href} data-testid="pupzy-back-to-queue" style={{ fontWeight: 600 }}>
          ← {backLink.label}
        </Link>
      </Box>

      <Box className="pupzy-review-header" mb="xl">
        <H3 mb="sm">{post.title}</H3>
        <div className="pupzy-discussion-meta">
          <Badge variant="primary">{post.typeLabel}</Badge>
          {post.subtypeLabel ? <Badge variant="secondary">{post.subtypeLabel}</Badge> : null}
          <StateTag value={post.status} label={post.statusLabel} />
          <StateTag value={post.moderationStatus} label={post.moderationStatusLabel} />
          {post.urgency ? <StateTag value={post.urgency} /> : null}
        </div>
        {post.description ? (
          <p className="pupzy-post-description" dir="auto">
            {post.description}
          </p>
        ) : null}
        <dl className="pupzy-post-facts">
          <div>
            <dt>Location</dt>
            <dd>{[post.cityName, post.areaName].filter(Boolean).join(', ') || 'No City selected'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              {formatDateTime(post.createdAt)} <span>({post.ageLabel})</span>
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              {post.owner?.name ?? 'Unknown'}
              <span>{post.owner?.email ?? 'No email available'}</span>
            </dd>
          </div>
        </dl>
        {post.moderationReason ? (
          <Text mt="xs" color="grey60">
            Moderation reason: {post.moderationReason}
          </Text>
        ) : null}
      </Box>

      <section
        className="pupzy-post-review-section"
        aria-labelledby="pupzy-review-photos-heading"
        data-testid="pupzy-original-photos"
      >
        <H4 id="pupzy-review-photos-heading" mb="md">
          Original photos {photos.length ? `(${photos.length})` : ''}
        </H4>
        {photos.length ? (
          <div className="pupzy-media-grid">
            {photos.map((photo, index) => (
              <MediaThumb
                key={photo.id}
                item={photo}
                index={index}
                total={photos.length}
                description={`Original photo ${index + 1} of ${photos.length} on this Post`}
                onOpen={(trigger) => openMedia(photos, index, trigger)}
              />
            ))}
          </div>
        ) : (
          <EmptyState>No photos are attached to this Post.</EmptyState>
        )}
      </section>

      <section
        className="pupzy-post-review-section"
        aria-labelledby="pupzy-review-discussion-heading"
        data-testid="pupzy-discussion"
      >
        <H4 id="pupzy-review-discussion-heading" mb="md">
          Community discussion
        </H4>
        {discussion && discussion.total > 0 ? (
          <>
            <ul className="pupzy-discussion-list" data-testid="pupzy-discussion-list">
              {discussion.items.map((item) => (
                <DiscussionItem key={item.id} item={item} onOpenMedia={openMedia} />
              ))}
            </ul>
            <nav className="pupzy-review-pagination" aria-label="Community discussion pages" aria-busy={loadingPage}>
              <Button
                variant="light"
                data-testid="pupzy-discussion-previous"
                disabled={loadingPage || discussion.page <= 1}
                onClick={() => void loadPage(discussion.page - 1)}
              >
                Previous
              </Button>
              <Text aria-live="polite" data-testid="pupzy-discussion-page">
                {loadingPage ? <Loader /> : null} Page {discussion.page} of {discussion.totalPages} · {discussion.total}{' '}
                {discussion.total === 1 ? 'Comment' : 'Comments'}
              </Text>
              <Button
                variant="light"
                data-testid="pupzy-discussion-next"
                disabled={loadingPage || discussion.page >= discussion.totalPages}
                onClick={() => void loadPage(discussion.page + 1)}
              >
                Next
              </Button>
            </nav>
            {pageError ? (
              <Text role="alert" color="error" mt="sm">
                {pageError}
              </Text>
            ) : null}
          </>
        ) : (
          <EmptyState>No Comments or Replies on this Post yet.</EmptyState>
        )}
      </section>

      <section
        className="pupzy-post-review-section"
        aria-labelledby="pupzy-review-reports-heading"
        data-testid="pupzy-reports"
      >
        <H4 id="pupzy-review-reports-heading" mb="md">
          Reports
        </H4>
        <H4 mb="sm" fontSize="sm">
          Post Reports {reports.postReports?.length ? `(${reports.postReports.length})` : ''}
        </H4>
        {reports.postReports?.length ? (
          <ul className="pupzy-report-list">
            {reports.postReports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                reviewHref={reportReviewHref('post_reports', report.id, returnTo, adminRootPath())}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>No Post Reports for this Post.</EmptyState>
        )}

        <H4 mb="sm" mt="lg" fontSize="sm">
          Comment Reports {reports.commentReports?.length ? `(${reports.commentReports.length})` : ''}
        </H4>
        {reports.commentReports?.length ? (
          <ul className="pupzy-report-list">
            {reports.commentReports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                context={`Comment state: ${report.commentStatusLabel ?? 'Unknown'}`}
                reviewHref={reportReviewHref('comment_reports', report.id, returnTo, adminRootPath())}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>No Comment Reports for this Post's discussion.</EmptyState>
        )}
      </section>

      <section
        className="pupzy-post-review-section"
        aria-labelledby="pupzy-review-history-heading"
        data-testid="pupzy-action-history"
      >
        <H4 id="pupzy-review-history-heading" mb="md">
          Action history
        </H4>
        {history.length ? (
          <ul className="pupzy-history-list">
            {history.map((entry) => (
              <li key={entry.id} className="pupzy-history-row">
                <div className="pupzy-discussion-meta">
                  <Text fontWeight="bold">{entry.actionLabel}</Text>
                  <Badge variant="default">{entry.targetType}</Badge>
                  <Text color="grey60" fontSize="sm">
                    {formatDateTime(entry.createdAt)}
                  </Text>
                </div>
                <Text color="grey60" fontSize="sm" mt="xs">
                  By {entry.adminName}
                </Text>
                {entry.reason ? <Text mt="xs">Reason: {entry.reason}</Text> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No administrator actions recorded for this Post.</EmptyState>
        )}
      </section>

      {dialog}
    </Box>
  );
}
