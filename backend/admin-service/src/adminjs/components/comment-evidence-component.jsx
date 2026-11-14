import React, { useMemo } from 'react';
import { Box, H4, Text } from '@adminjs/design-system';

import { StatusBadge } from './status-badge-component.jsx';
import { MediaThumb, useMediaLightbox } from './media-lightbox.jsx';
import { RecordLink } from './record-link.jsx';

function parse(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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

function Meta({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Text color="grey60" fontSize="sm" style={{ minWidth: 72 }}>
        {label}
      </Text>
      {children}
    </div>
  );
}

function ReportItem({ report, isCurrent }) {
  return (
    <li className="pupzy-report-row" data-testid="pupzy-comment-report" style={{ listStyle: 'none' }}>
      <div className="pupzy-discussion-meta">
        <Text fontWeight="bold">{report.reasonLabel}</Text>
        <StatusBadge value={report.statusState}>{report.statusLabel}</StatusBadge>
        {isCurrent ? <StatusBadge value="CLOSED" label="This report"></StatusBadge> : null}
      </div>
      {report.details ? (
        <Text mt="xs" dir="auto">
          {report.details}
        </Text>
      ) : null}
      <div
        className="pupzy-report-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text color="grey60" fontSize="sm" as="span">
            Reported by
          </Text>
          <RecordLink
            resourceId="users"
            recordId={report.reporter.id}
            title={report.reporter.name}
            pictureUrl={report.reporter.pictureUrl}
            showAvatar
            testId="pupzy-comment-report-reporter"
          />
          <Text color="grey60" fontSize="sm" as="span">
            · {formatDateTime(report.createdAt)}
          </Text>
        </span>
        {isCurrent ? null : (
          <RecordLink
            resourceId="comment_reports"
            recordId={report.id}
            title="Open report"
            testId="pupzy-comment-report-link"
          />
        )}
      </div>
    </li>
  );
}

/**
 * The Comment a moderator is reviewing: full text, images (moderators see
 * hidden ones too, marked), where it sits, and every Comment Report raised
 * against it. Used on the Comment page and above the Comment Report fields.
 */
export default function CommentEvidence({ record }) {
  const evidence = useMemo(() => parse(record?.params?.comment_evidence), [record]);
  const { openMedia, dialog } = useMediaLightbox();
  if (!evidence) return null;

  const { author, post, parent, media, reports } = evidence;
  return (
    <Box variant="white" mb="xl" data-testid="pupzy-comment-evidence" aria-label="Comment under review">
      <div className="pupzy-discussion-meta" style={{ marginBottom: 12 }}>
        <H4 mb="0">{evidence.isReply ? 'Reply' : 'Comment'}</H4>
        <StatusBadge value={evidence.status} data-testid="pupzy-comment-status">
          {evidence.imagesHidden
            ? 'Images hidden from users'
            : evidence.hidden
              ? 'Hidden from users'
              : evidence.statusLabel}
        </StatusBadge>
      </div>

      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        <Meta label="Author">
          <RecordLink
            resourceId="users"
            recordId={author.id}
            title={author.name}
            pictureUrl={author.pictureUrl}
            showAvatar
            testId="pupzy-comment-author"
          />
          <Text color="grey60" fontSize="sm">
            {formatDateTime(evidence.createdAt)}
          </Text>
        </Meta>
        {post ? (
          <Meta label="Post">
            <RecordLink
              resourceId="posts"
              recordId={post.id}
              title={post.title || 'Review Post'}
              testId="pupzy-comment-post"
            />
          </Meta>
        ) : null}
        {parent ? (
          <Meta label="Reply to">
            <RecordLink
              resourceId="comments"
              recordId={parent.id}
              title={parent.excerpt || 'Parent Comment'}
              testId="pupzy-comment-parent"
            />
          </Meta>
        ) : null}
      </div>

      <p
        dir="auto"
        data-testid="pupzy-comment-text"
        style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px', fontSize: 15 }}
      >
        {evidence.text}
      </p>

      {media.length ? (
        <div className="pupzy-media-grid" data-testid="pupzy-comment-images" style={{ marginBottom: 12 }}>
          {media.map((item, index) => (
            <div key={item.id} style={{ display: 'grid', gap: 4 }}>
              <MediaThumb
                item={item}
                index={index}
                total={media.length}
                description={`Comment image ${index + 1} of ${media.length}`}
                onOpen={(trigger) => openMedia(media, index, trigger)}
              />
              {item.hiddenFromUsers ? (
                <StatusBadge value="HIDDEN" data-testid="pupzy-image-hidden-badge">
                  Hidden from users
                </StatusBadge>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <H4 mb="sm" fontSize="sm">
        Reports on this comment {reports.length ? `(${reports.length})` : ''}
      </H4>
      {reports.length ? (
        <ul className="pupzy-report-list" style={{ padding: 0, margin: 0 }}>
          {reports.map((report) => (
            <ReportItem key={report.id} report={report} isCurrent={report.id === evidence.currentReportId} />
          ))}
        </ul>
      ) : (
        <Text color="grey60">No reports on this comment.</Text>
      )}
      {dialog}
    </Box>
  );
}
