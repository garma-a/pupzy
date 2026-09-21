import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';
import { Badge, Box, Button, H3, H4, Icon, Link, Loader, MessageBox, Modal, Text } from '@adminjs/design-system';

const api = new ApiClient();
const DISCUSSION_ACTION = 'postReviewDiscussion';

function adminResourceUrl(path) {
  const rootPath =
    (typeof window !== 'undefined' && window.REDUX_STATE && window.REDUX_STATE.paths?.rootPath) || '/admin';
  return `${rootPath}/resources/${path}`;
}

const COMMENT_BADGE_VARIANTS = {
  ACTIVE: 'success',
  IMAGE_HIDDEN: 'warning',
  HIDDEN: 'warning',
  DELETED: 'default',
  REMOVED: 'danger',
};

const REPORT_BADGE_VARIANTS = {
  Open: 'warning',
  Reviewed: 'default',
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

function imageLabel(item, index, total) {
  const dimensions = item?.width && item?.height ? `, ${item.width} by ${item.height} pixels` : '';
  return `Open photo ${index + 1} of ${total}${dimensions}`;
}

function MediaThumb({ item, index, total, description, onOpen }) {
  const [failed, setFailed] = useState(false);
  const unavailable = !item.url || failed;

  return (
    <button
      type="button"
      className="pupzy-media-thumb"
      data-testid="pupzy-media-thumb"
      data-unavailable={unavailable ? 'true' : 'false'}
      aria-label={unavailable ? `Photo ${index + 1} of ${total} is unavailable` : imageLabel(item, index, total)}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {unavailable ? (
        <span className="pupzy-media-fallback" role="img" aria-label="Image unavailable">
          <Icon icon="Image" />
          <span>Image unavailable</span>
        </span>
      ) : (
        <img src={item.url} alt={description} loading="lazy" onError={() => setFailed(true)} />
      )}
    </button>
  );
}

function ImageDialog({ items, index, onClose, onNavigate }) {
  const containerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const current = items[index];

  useEffect(() => {
    setFailed(false);
  }, [index]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowRight' && items.length > 1) {
        event.preventDefault();
        onNavigate(1);
        return;
      }
      if (event.key === 'ArrowLeft' && items.length > 1) {
        event.preventDefault();
        onNavigate(-1);
        return;
      }
      if (event.key === 'Tab') {
        const root = containerRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items.length, onClose, onNavigate]);

  const unavailable = !current?.url || failed;

  return (
    <Modal onOverlayClick={onClose} width={['94vw', 'min(94vw, 1080px)']}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Full image preview, image ${index + 1} of ${items.length}`}
        className="pupzy-media-dialog"
        data-testid="pupzy-image-dialog"
        ref={containerRef}
      >
        <div className="pupzy-media-dialog-header">
          <Text fontWeight="bold" aria-live="polite">
            {index + 1} of {items.length}
          </Text>
          <Button
            ref={closeButtonRef}
            size="icon"
            variant="light"
            aria-label="Close image preview"
            data-testid="pupzy-image-dialog-close"
            onClick={onClose}
          >
            <Icon icon="X" />
          </Button>
        </div>

        {unavailable ? (
          <div className="pupzy-media-dialog-fallback" role="img" aria-label="Image unavailable">
            <Icon icon="Image" />
            <Text>This image is unavailable.</Text>
          </div>
        ) : (
          <img
            className="pupzy-media-dialog-content"
            data-testid="pupzy-image-dialog-content"
            src={current.url}
            alt={`Full preview ${index + 1} of ${items.length}`}
            onError={() => setFailed(true)}
          />
        )}

        {items.length > 1 ? (
          <div className="pupzy-media-dialog-nav">
            <Button
              variant="light"
              aria-label="Previous image"
              disabled={items.length < 2}
              onClick={() => onNavigate(-1)}
            >
              Previous
            </Button>
            <Button variant="light" aria-label="Next image" disabled={items.length < 2} onClick={() => onNavigate(1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
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
  return (
    <li className="pupzy-report-row">
      <div className="pupzy-discussion-meta">
        <Text fontWeight="bold">{report.reasonLabel}</Text>
        <Badge variant={REPORT_BADGE_VARIANTS[report.statusLabel] ?? 'default'}>{report.statusLabel}</Badge>
        {report.reviewOutcomeLabel ? (
          <Text color="grey60" fontSize="sm">
            {report.reviewOutcomeLabel}
          </Text>
        ) : null}
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
        <Link href={reviewHref} target="_blank" rel="noopener noreferrer" data-testid="pupzy-report-review-link">
          Review this report
        </Link>
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
  const [dialog, setDialog] = useState(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setDiscussion(review?.discussion ?? null);
    setPageError('');
  }, [review]);

  const openMedia = useCallback((items, index, trigger) => {
    triggerRef.current = trigger ?? null;
    setDialog({ items, index });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger) trigger.focus();
  }, []);

  const navigateDialog = useCallback((delta) => {
    setDialog((current) => {
      if (!current) return current;
      const nextIndex = (current.index + delta + current.items.length) % current.items.length;
      return { ...current, index: nextIndex };
    });
  }, []);

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

  return (
    <Box className="pupzy-post-review" p="xl" mb="xl" data-testid="pupzy-review-workspace">
      <H3 mb="md">Review workspace</H3>

      <Box className="pupzy-review-header" mb="xl">
        <H3 mb="sm">{post.title}</H3>
        <div className="pupzy-discussion-meta">
          <Badge variant="primary">{post.typeLabel}</Badge>
          {post.subtypeLabel ? <Badge variant="secondary">{post.subtypeLabel}</Badge> : null}
          <Badge variant={post.status === 'ACTIVE' ? 'success' : 'default'}>{post.statusLabel}</Badge>
          <Badge variant={post.moderationStatus === 'FLAGGED' ? 'danger' : 'default'}>
            {post.moderationStatusLabel}
          </Badge>
          {post.urgency ? <Badge variant="warning">{post.urgency}</Badge> : null}
        </div>
        <Text mt="sm" color="grey60">
          {[post.cityName, post.areaName].filter(Boolean).join(' · ') || 'No City selected'} · Created{' '}
          {formatDateTime(post.createdAt)} ({post.ageLabel}) · Owner {post.owner?.name ?? 'Unknown'} (
          {post.owner?.email ?? 'no email'})
        </Text>
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
          <EmptyState>No photos were attached to this Post.</EmptyState>
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
                reviewHref={adminResourceUrl(`post_reports/records/${encodeURIComponent(report.id)}/show`)}
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
                reviewHref={adminResourceUrl(`comment_reports/records/${encodeURIComponent(report.id)}/show`)}
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

      {dialog ? (
        <ImageDialog items={dialog.items} index={dialog.index} onClose={closeDialog} onNavigate={navigateDialog} />
      ) : null}
    </Box>
  );
}
