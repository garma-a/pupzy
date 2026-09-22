import { Property } from '@adminjs/sql';

import { COMPLETED_POST_STATUSES, LOST_SUBTYPE_VALUES, REPORT_REVIEW_STATE_VALUES } from './queue-constants.js';

export { COMPLETED_POST_STATUSES, LOST_SUBTYPE_VALUES, REPORT_REVIEW_STATE_VALUES };

/**
 * Virtual, read-only filter columns exposed by the AdminJS SQL resource for
 * work-queue navigation. They are not table columns; `QueueAwareSqlResource`
 * translates them into the predicates below so queue counts and filtered list
 * pages share one definition.
 */
const VIRTUAL_FILTERS = Object.freeze({
  posts: Object.freeze({
    report_type: LOST_SUBTYPE_VALUES,
    queue: Object.freeze(['completed']),
  }),
  post_reports: Object.freeze({ review_state: REPORT_REVIEW_STATE_VALUES }),
  comment_reports: Object.freeze({ review_state: REPORT_REVIEW_STATE_VALUES }),
  account_reports: Object.freeze({ review_state: REPORT_REVIEW_STATE_VALUES }),
});

export function virtualFilterNames(tableName) {
  return Object.keys(VIRTUAL_FILTERS[tableName] ?? {});
}

export function virtualFilterProperties(tableName) {
  const definitions = VIRTUAL_FILTERS[tableName] ?? {};
  return Object.entries(definitions).map(
    ([name, values], index) =>
      new Property({
        name,
        isId: false,
        position: 10_000 + index,
        isNullable: true,
        isEditable: false,
        type: 'string',
        availableValues: [...values],
      }),
  );
}

export function virtualFilterOptions(tableName) {
  const definitions = VIRTUAL_FILTERS[tableName] ?? {};
  return Object.fromEntries(
    Object.entries(definitions).map(([name, values]) => [
      name,
      {
        availableValues: values.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
        isVisible: { list: false, show: false, edit: false, filter: true },
      },
    ]),
  );
}

function applyReportReviewState(query, value) {
  if (value === 'OPEN') {
    query.whereNull('reviewed_at');
    return true;
  }
  if (value === 'REVIEWED') {
    query.whereNotNull('reviewed_at');
    return true;
  }
  return false;
}

/**
 * Applies one virtual queue filter to a Knex query. Unknown values are ignored
 * rather than passed through as a column predicate. Returns whether the value
 * was recognized.
 */
export function applyVirtualFilter(query, { tableName, key, value, knex, schemaName }) {
  if (tableName === 'posts' && key === 'report_type') {
    if (!LOST_SUBTYPE_VALUES.includes(value)) return false;
    const subquery = schemaName ? knex('lost_posts').withSchema(schemaName) : knex('lost_posts');
    query.whereIn('id', subquery.select('post_id').where('report_type', value));
    return true;
  }
  if (tableName === 'posts' && key === 'queue') {
    if (value !== 'completed') return false;
    query.whereIn('status', [...COMPLETED_POST_STATUSES]);
    return true;
  }
  if (key === 'review_state' && ['post_reports', 'comment_reports', 'account_reports'].includes(tableName)) {
    return applyReportReviewState(query, value);
  }
  return false;
}
