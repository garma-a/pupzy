import { COMPLETED_POST_STATUSES } from '../queue-constants.js';

const COMPLETED_STATUS_LIST = COMPLETED_POST_STATUSES.map((status) => `'${status}'`).join(', ');

/**
 * Builds the AdminJS list URL for one queue from its filter parameters. The
 * default root path matches the AdminJS `rootPath`; the dashboard component
 * passes the runtime root path.
 */
export function queueHref(queue, rootPath = '/admin') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queue?.filters ?? {})) {
    params.set(`filters.${key}`, value);
  }
  const query = params.toString();
  return `${rootPath}/resources/${queue?.resource}${query ? `?${query}` : ''}`;
}

/**
 * Dashboard work-queue definitions. Each queue carries the AdminJS list filter
 * parameters used by the navigation links and the SQL predicate used for its
 * dashboard count, so a queue's count and its filtered list page share one
 * definition. `resource` is the AdminJS resource id (also the table name).
 */
export const WORK_QUEUE_GROUPS = Object.freeze([
  {
    id: 'needs_review',
    label: 'Needs review',
    description:
      'Moderation flags, posts still awaiting moderation and open Reports are separate work so the counts never blur together.',
    queues: [
      {
        id: 'flagged',
        label: 'Flagged — needs review',
        resource: 'posts',
        filters: { moderation_status: 'FLAGGED', status: 'ACTIVE' },
        predicate: `moderation_status = 'FLAGGED' AND status = 'ACTIVE'`,
      },
      {
        id: 'pending_moderation',
        label: 'Pending moderation',
        resource: 'posts',
        filters: { moderation_status: 'PENDING_AUTO_REVIEW', status: 'ACTIVE' },
        predicate: `moderation_status = 'PENDING_AUTO_REVIEW' AND status = 'ACTIVE'`,
      },
      {
        id: 'open_post_reports',
        label: 'Open Post Reports',
        resource: 'post_reports',
        filters: { review_state: 'OPEN' },
        predicate: 'reviewed_at IS NULL',
      },
      {
        id: 'open_comment_reports',
        label: 'Open Comment Reports',
        resource: 'comment_reports',
        filters: { review_state: 'OPEN' },
        predicate: 'reviewed_at IS NULL',
      },
      {
        id: 'open_account_reports',
        label: 'Open Account Reports',
        resource: 'account_reports',
        filters: { review_state: 'OPEN' },
        predicate: 'reviewed_at IS NULL',
      },
    ],
  },
  {
    id: 'rescue',
    label: 'Rescue',
    description: 'Active rescue cases, with the existing urgency, City, date and moderation filters.',
    queues: [
      {
        id: 'rescue',
        label: 'Active rescue',
        resource: 'posts',
        filters: { post_type: 'RESCUE', status: 'ACTIVE' },
        predicate: `post_type = 'RESCUE' AND status = 'ACTIVE'`,
      },
    ],
  },
  {
    id: 'lost_found',
    label: 'Lost & found',
    description: 'Active lost/found cases, split into lost pets and found strays.',
    queues: [
      {
        id: 'lost_found',
        label: 'All lost & found',
        resource: 'posts',
        filters: { post_type: 'LOST', status: 'ACTIVE' },
        predicate: `post_type = 'LOST' AND status = 'ACTIVE'`,
      },
      {
        id: 'lost_pet',
        label: 'Lost pet',
        resource: 'posts',
        filters: { post_type: 'LOST', status: 'ACTIVE', report_type: 'LOST_PET' },
        predicate: `post_type = 'LOST' AND status = 'ACTIVE' AND id IN (SELECT post_id FROM lost_posts WHERE report_type = 'LOST_PET')`,
      },
      {
        id: 'found_stray',
        label: 'Found stray',
        resource: 'posts',
        filters: { post_type: 'LOST', status: 'ACTIVE', report_type: 'FOUND_STRAY' },
        predicate: `post_type = 'LOST' AND status = 'ACTIVE' AND id IN (SELECT post_id FROM lost_posts WHERE report_type = 'FOUND_STRAY')`,
      },
    ],
  },
  {
    id: 'listings',
    label: 'Listings',
    description: 'Active adoption, product and mating listings, with type and lifecycle filters.',
    queues: [
      {
        id: 'adoption',
        label: 'Adoption',
        resource: 'posts',
        filters: { post_type: 'ADOPTION', status: 'ACTIVE' },
        predicate: `post_type = 'ADOPTION' AND status = 'ACTIVE'`,
      },
      {
        id: 'products',
        label: 'Products',
        resource: 'posts',
        filters: { post_type: 'PRODUCT', status: 'ACTIVE' },
        predicate: `post_type = 'PRODUCT' AND status = 'ACTIVE'`,
      },
      {
        id: 'mating',
        label: 'Mating',
        resource: 'posts',
        filters: { post_type: 'MATING', status: 'ACTIVE' },
        predicate: `post_type = 'MATING' AND status = 'ACTIVE'`,
      },
    ],
  },
  {
    id: 'history',
    label: 'History',
    description: 'Completed outcomes, expired listings and removed Posts stay distinct views.',
    queues: [
      {
        id: 'completed',
        label: 'Completed',
        resource: 'posts',
        filters: { queue: 'completed' },
        predicate: `status IN (${COMPLETED_STATUS_LIST})`,
      },
      {
        id: 'expired',
        label: 'Expired',
        resource: 'posts',
        filters: { status: 'EXPIRED' },
        predicate: `status = 'EXPIRED'`,
      },
      {
        id: 'removed',
        label: 'Removed',
        resource: 'posts',
        filters: { status: 'REMOVED' },
        predicate: `status = 'REMOVED'`,
      },
    ],
  },
]);

export const WORK_QUEUES = Object.freeze(
  WORK_QUEUE_GROUPS.flatMap((group) =>
    group.queues.map((queue) =>
      Object.freeze({
        ...queue,
        group: group.id,
        groupLabel: group.label,
      }),
    ),
  ),
);

export function buildWorkQueueCountSql() {
  const selects = WORK_QUEUES.map(
    (queue) => `(SELECT count(*) FROM ${queue.resource} WHERE ${queue.predicate}) AS "${queue.id}"`,
  );
  return `SELECT ${selects.join(', ')}`;
}

export async function loadWorkQueueCounts(pool) {
  const { rows } = await pool.query(buildWorkQueueCountSql());
  return rows[0] ?? {};
}
