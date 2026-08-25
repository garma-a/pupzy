import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  Badge,
  Box,
  Button,
  H2,
  H3,
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

  if (loading && !data) return <Loader />;

  return (
    <Box p="xl">
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="xl">
        <H2>Pupzy moderation overview</H2>
        <Button disabled={loading} onClick={() => void load(true)}>
          {loading ? 'Refreshing…' : 'Refresh now'}
        </Button>
      </Box>
      {error ? <Text color="error">{error}</Text> : null}
      <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gridGap="lg" mb="xl">
        {statLabels.map(([key, label]) => {
          const alert = ['needs_review_posts', 'flagged_posts'].includes(key) && Number(data?.stats?.[key]) > 0;
          return (
            <Box key={key} variant="white" p="lg" borderLeft={alert ? '4px solid #c00' : undefined}>
              <Text variant="sm">{label}</Text>
              <H2>{Number(data?.stats?.[key] ?? 0).toLocaleString()}</H2>
            </Box>
          );
        })}
      </Box>
      <Text mb="xl" variant="sm">
        Statistics computed {data?.stats?.computedAt ? new Date(data.stats.computedAt).toLocaleString() : '—'}
      </Text>

      <Box variant="white" p="lg">
        <H3 mb="lg">Posts needing review</H3>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Moderation</TableCell>
              <TableCell>Reports</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data?.needsReview ?? []).map((post) => (
              <TableRow key={post.id}>
                <TableCell>
                  <Link href={`/admin/resources/posts/records/${encodeURIComponent(post.id)}/show`}>{post.title}</Link>
                </TableCell>
                <TableCell>{post.post_type}</TableCell>
                <TableCell>
                  <Badge variant={post.moderation_status === 'FLAGGED' ? 'danger' : 'warning'}>
                    {post.moderation_status.replaceAll('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>{post.report_count}</TableCell>
                <TableCell>{new Date(post.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!data?.needsReview?.length ? <Text mt="lg">No active posts need review.</Text> : null}
      </Box>
    </Box>
  );
}
