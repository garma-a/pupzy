import { WORK_QUEUES } from '../dashboard/work-queues.js';
export const POST_QUEUE_IDS = Object.freeze([
  'rescue',
  'lost_pet',
  'found_stray',
  'adoption',
  'products',
  'mating',
  'completed',
  'expired',
  'removed',
]);
export async function attachListSummaries(pool, kind, response, cache) {
  if (!['posts', 'users', 'comments'].includes(kind)) return response;
  const records = response.records ?? [],
    ids = records.map((r) => r.id);
  const sql = {
    posts: `SELECT p.id,m.public_url AS thumbnail,COALESCE(r.n,0)::int AS open_reports FROM posts p
 LEFT JOIN (SELECT DISTINCT ON(post_id) post_id,public_url FROM post_media WHERE post_id=ANY($1::uuid[]) ORDER BY post_id,display_order,created_at,id) m ON m.post_id=p.id
 LEFT JOIN (SELECT post_id,count(*) AS n FROM post_reports WHERE post_id=ANY($1::uuid[]) AND reviewed_at IS NULL GROUP BY post_id) r ON r.post_id=p.id WHERE p.id=ANY($1::uuid[])`,
    users: `SELECT reported_user_id AS id,count(*)::int AS open_reports FROM account_reports WHERE reported_user_id=ANY($1::uuid[]) AND reviewed_at IS NULL GROUP BY reported_user_id`,
    comments: `SELECT c.id,COALESCE(r.n,0)::int AS open_reports,COALESCE(m.n,0)::int AS images_count FROM comments c
 LEFT JOIN (SELECT comment_id,count(*) AS n FROM comment_reports WHERE comment_id=ANY($1::uuid[]) AND reviewed_at IS NULL GROUP BY comment_id) r ON r.comment_id=c.id
 LEFT JOIN (SELECT comment_id,count(*) AS n FROM comment_media WHERE comment_id=ANY($1::uuid[]) GROUP BY comment_id) m ON m.comment_id=c.id WHERE c.id=ANY($1::uuid[])`,
  };
  const [details, counts] = await Promise.all([
    ids.length ? pool.query(sql[kind], [ids]) : { rows: [] },
    kind === 'posts' ? cache.getQueueCounts(pool) : null,
  ]);
  const byId = new Map(details.rows.map((r) => [r.id, r]));
  for (const record of records)
    record.params = {
      ...record.params,
      open_reports: 0,
      ...(kind === 'comments' ? { images_count: 0 } : {}),
      ...byId.get(record.id),
    };
  if (counts)
    response.postQueues = WORK_QUEUES.filter((q) => POST_QUEUE_IDS.includes(q.id)).map(
      ({ id, label, resource, filters }) => ({ id, label, resource, filters, count: Number(counts[id] ?? 0) }),
    );
  return response;
}

export function listOnlyProperty(component, type = 'number') {
  return {
    type,
    isDisabled: true,
    isSortable: false,
    isVisible: { list: true, show: false, edit: false, filter: false },
    ...(component ? { components: { list: component } } : {}),
  };
}
export function attachReadableList(resource, pool, cache) {
  const name = resource.resource.tableName;
  if (!['posts', 'users', 'comments'].includes(name)) return resource;
  const list = resource.options.actions.list ?? {};
  const previous = list.after ? (Array.isArray(list.after) ? list.after : [list.after]) : [];
  return {
    ...resource,
    options: {
      ...resource.options,
      actions: {
        ...resource.options.actions,
        list: { ...list, after: [...previous, (response) => attachListSummaries(pool, name, response, cache)] },
      },
    },
  };
}
