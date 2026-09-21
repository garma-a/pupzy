import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';
import { queueHref } from './work-queues.js';
import {
  Badge,
  Box,
  Button,
  H2,
  H3,
  H4,
  Link,
  Loader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Text,
} from '@adminjs/design-system';

const api = new ApiClient();

const statLabels = [
  ['total_users', 'Total Users'],
  ['banned_users', 'Banned Users'],
  ['total_posts', 'Total Posts'],
  ['active_posts', 'Active Posts'],
  ['needs_review_posts', 'Needs Review'],
  ['flagged_posts', 'Flagged'],
];

const ALERT_GROUPS = ['needs_review'];

function adminRootPath() {
  return (typeof window !== 'undefined' && window.REDUX_STATE && window.REDUX_STATE.paths?.rootPath) || '/admin';
}

function QueueButton({ queue }) {
  const isAlert = ALERT_GROUPS.includes(queue.group) && queue.count > 0;
  return (
    <Link
      href={queueHref(queue, adminRootPath())}
      className="pupzy-queue-button"
      data-testid={`pupzy-queue-${queue.id}`}
      data-alert={isAlert ? 'true' : 'false'}
    >
      <span className="pupzy-queue-button-label">{queue.label}</span>
      <span className="pupzy-queue-button-meta">
        <span className="pupzy-queue-button-count" aria-label={`${queue.count} records`}>
          {queue.count.toLocaleString()}
        </span>
        <span aria-hidden="true" className="pupzy-queue-button-arrow">
          →
        </span>
      </span>
    </Link>
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
    setError('');
    try {
      const response = await api.getDashboard(fresh ? { params: { fresh: 'true' } } : undefined);
      setData(response.data);
    } catch {
      setError('Dashboard data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <Box p="xxl" display="flex" justifyContent="center" alignItems="center" flexDirection="column" minHeight="350px">
        <Loader style={{ borderTopColor: '#C4622D' }} />
        <Text mt="lg" style={{ color: '#8B6355', fontSize: '14px', fontWeight: 500 }}>
          Loading Pupzy moderation overview…
        </Text>
      </Box>
    );
  }

  const queues = data?.queues ?? [];
  const flaggedQueue = queues.find((queue) => queue.id === 'flagged');

  return (
    <Box p="xl" style={{ backgroundColor: '#FAF6F1', minHeight: '100%' }}>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb="xl"
        flexWrap="wrap"
        style={{ gap: '16px' }}
      >
        <H2 style={{ fontFamily: "'Playfair Display', 'Cairo', serif", color: '#2D1506', margin: 0 }}>
          Pupzy moderation overview
        </H2>
        <Button
          variant="primary"
          disabled={loading}
          onClick={() => void load(true)}
          style={{
            backgroundColor: '#C4622D',
            borderColor: '#C4622D',
            color: '#FFFFFF',
            borderRadius: '999px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </Button>
      </Box>

      {/* Error state if reload fails */}
      {error ? (
        <Box
          p="lg"
          mb="xl"
          style={{
            backgroundColor: '#F9E5E7',
            border: '1px solid #F3C4CB',
            borderRadius: '16px',
            color: '#9D0616',
          }}
        >
          <Text color="error" style={{ fontWeight: 600 }}>
            {error}
          </Text>
          <Button mt="md" variant="danger" onClick={() => void load(true)} style={{ borderRadius: '999px' }}>
            Retry
          </Button>
        </Box>
      ) : null}

      {/* Responsive Metric Cards Grid (3x2 on ordinary desktop, 6 on wide desktop) */}
      <div className="pupzy-metric-grid">
        {statLabels.map(([key, label]) => {
          const rawCount = Number(data?.stats?.[key] ?? 0);
          const isAlert = ['needs_review_posts', 'flagged_posts'].includes(key) && rawCount > 0;
          return (
            <Box
              key={key}
              variant="white"
              p="lg"
              className="pupzy-card"
              style={{
                backgroundColor: isAlert ? '#FFF8F6' : '#FFFFFF',
                border: `1px solid ${isAlert ? '#F3C4CB' : '#E8DED5'}`,
                borderLeft: isAlert ? '4px solid #D94040' : `1px solid ${isAlert ? '#F3C4CB' : '#E8DED5'}`,
                borderRadius: '16px',
                boxShadow: '0 2px 8px rgba(45, 21, 6, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                minHeight: '96px',
              }}
            >
              <Text
                variant="sm"
                style={{
                  color: isAlert ? '#9D0616' : '#8B6355',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontSize: '12px',
                }}
              >
                {label}
              </Text>
              <H2
                style={{
                  fontSize: '26px',
                  fontWeight: 700,
                  color: isAlert ? '#D94040' : '#2D1506',
                  margin: '6px 0 0 0',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: "'DM Sans', 'Cairo', sans-serif",
                }}
                title={rawCount.toLocaleString()}
              >
                {rawCount.toLocaleString()}
              </H2>
            </Box>
          );
        })}
      </div>

      <Text mb="xl" variant="sm" style={{ color: '#8B6355' }}>
        Statistics computed {data?.stats?.computedAt ? new Date(data.stats.computedAt).toLocaleString() : '—'}
      </Text>

      {/* Work queues */}
      <H3 mb="lg" style={{ fontFamily: "'Playfair Display', 'Cairo', serif", color: '#2D1506' }}>
        Work queues
      </H3>
      <div className="pupzy-queue-groups" data-testid="pupzy-work-queues">
        {queueGroups(queues).map((group) => (
          <Box
            key={group.id}
            variant="white"
            p="lg"
            className="pupzy-card pupzy-queue-group"
            data-testid={`pupzy-queue-group-${group.id}`}
          >
            <H4 mb="sm" style={{ color: '#2D1506' }}>
              {group.label}
            </H4>
            <div className="pupzy-queue-grid">
              {group.queues.map((queue) => (
                <QueueButton key={queue.id} queue={queue} />
              ))}
            </div>
          </Box>
        ))}
      </div>

      {/* Posts Needing Review Card */}
      <Box
        variant="white"
        p="lg"
        className="pupzy-card"
        mt="xl"
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E8DED5',
          borderRadius: '16px',
          boxShadow: '0 2px 8px rgba(45, 21, 6, 0.04)',
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" style={{ gap: '12px' }}>
          <H3 style={{ fontFamily: "'Playfair Display', 'Cairo', serif", color: '#2D1506', margin: 0 }}>
            Posts needing review
          </H3>
          {flaggedQueue ? (
            <Link
              href={queueHref(flaggedQueue, adminRootPath())}
              className="pupzy-queue-button pupzy-queue-button-inline"
              data-testid="pupzy-view-all-flagged"
            >
              <span className="pupzy-queue-button-label">Flagged — needs review</span>
              <span className="pupzy-queue-button-count" aria-label={`${flaggedQueue.count} records`}>
                {flaggedQueue.count.toLocaleString()}
              </span>
            </Link>
          ) : null}
        </Box>
        <div
          data-testid="pupzy-needs-review-table"
          style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}
        >
          <Table style={{ width: '100%', minWidth: '650px', borderCollapse: 'separate', borderSpacing: 0 }}>
            <TableHead>
              <TableRow>
                <TableCell style={{ width: '35%', minWidth: '200px', whiteSpace: 'nowrap' }}>Title</TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>Type</TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>Moderation</TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>Open reports</TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.needsReview ?? []).map((post) => (
                <TableRow key={post.id}>
                  <TableCell style={{ maxWidth: '280px' }}>
                    <div
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '280px',
                      }}
                      title={post.title}
                    >
                      <Link
                        href={`/admin/resources/posts/records/${encodeURIComponent(post.id)}/show`}
                        style={{ color: '#C4622D', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {post.title}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell style={{ whiteSpace: 'nowrap' }}>{post.post_type?.replaceAll('_', ' ')}</TableCell>
                  <TableCell style={{ whiteSpace: 'nowrap' }}>
                    <Badge
                      variant={post.moderation_status === 'FLAGGED' ? 'danger' : 'warning'}
                      style={{
                        backgroundColor: post.moderation_status === 'FLAGGED' ? '#F9E5E7' : '#F6EDE8',
                        color: post.moderation_status === 'FLAGGED' ? '#9D0616' : '#A14F17',
                        border: `1px solid ${post.moderation_status === 'FLAGGED' ? '#F3C4CB' : '#ECD5C8'}`,
                        borderRadius: '6px',
                        fontWeight: 600,
                      }}
                    >
                      {post.moderation_status.replaceAll('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {Number(post.open_report_count ?? 0)}
                  </TableCell>
                  <TableCell style={{ whiteSpace: 'nowrap', color: '#8B6355' }}>
                    {new Date(post.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!data?.needsReview?.length ? (
          <Box
            p="xl"
            textAlign="center"
            style={{
              backgroundColor: '#FAF6F1',
              borderRadius: '12px',
              border: '1px dashed #E8DED5',
              margin: '16px 0',
            }}
          >
            <Text style={{ color: '#2D8B6F', fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
              ✓ All clear!
            </Text>
            <Text style={{ color: '#8B6355', fontSize: '13px' }}>
              No active posts currently require moderation review.
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
