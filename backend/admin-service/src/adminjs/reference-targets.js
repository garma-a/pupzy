/**
 * Polymorphic references (a type column plus a bare id column) have no foreign
 * key, so AdminJS cannot populate them. `account_reports.source_id` is typed by
 * `source_type` and `moderation_actions.target_id` by `target_type`. The `after`
 * hook below resolves a whole page of them with one query per target type and
 * stores the result in `record.populated`, the same place AdminJS puts a real
 * reference, so `ReferenceLink` renders both kinds the same way.
 */

/** Admin resource and lookup query for each polymorphic target type. */
export const POLYMORPHIC_TARGETS = Object.freeze({
  POST: Object.freeze({ resourceId: 'posts', sql: 'SELECT id, title FROM posts WHERE id = ANY($1::uuid[])' }),
  COMMENT: Object.freeze({ resourceId: 'comments', sql: 'SELECT id, text FROM comments WHERE id = ANY($1::uuid[])' }),
  USER: Object.freeze({
    resourceId: 'users',
    sql: `SELECT id, full_name, full_name_arabic, email, profile_picture_url FROM users WHERE id = ANY($1::uuid[])`,
  }),
  ANNOUNCEMENT: Object.freeze({
    resourceId: 'announcements',
    sql: 'SELECT id, title_en FROM announcements WHERE id = ANY($1::uuid[])',
  }),
  CONTACT_REQUEST: Object.freeze({
    resourceId: 'contact_requests',
    sql: 'SELECT id FROM contact_requests WHERE id = ANY($1::uuid[])',
  }),
  ADOPTION_APPLICATION: Object.freeze({
    resourceId: 'adoption_applications',
    sql: 'SELECT id FROM adoption_applications WHERE id = ANY($1::uuid[])',
  }),
});

export function polymorphicResourceId(type) {
  return POLYMORPHIC_TARGETS[type]?.resourceId ?? null;
}

/**
 * Loads every `{ type, id }` pair with one query per distinct type.
 * Resolves to a Map keyed `TYPE:id` holding the row, or `null` for a row that
 * does not exist.
 */
export async function loadPolymorphicTargets(pool, refs) {
  const idsByType = new Map();
  for (const { type, id } of refs) {
    if (!POLYMORPHIC_TARGETS[type] || !id) continue;
    if (!idsByType.has(type)) idsByType.set(type, new Set());
    idsByType.get(type).add(id);
  }
  const found = new Map();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      const { rows } = await pool.query(POLYMORPHIC_TARGETS[type].sql, [[...ids]]);
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of ids) found.set(`${type}:${id}`, byId.get(id) ?? null);
    }),
  );
  return found;
}

function recordsOf(response) {
  return response?.records ?? (response?.record ? [response.record] : []);
}

/**
 * AdminJS `after` hook for list and show. `typeField` names the column holding
 * the target type, `idField` the column holding the id.
 */
export function buildPolymorphicReferenceHook(pool, { typeField, idField }) {
  return async (response) => {
    if (!pool || typeof pool.query !== 'function') return response;
    const records = recordsOf(response);
    const refs = records.map((record) => ({ type: record.params?.[typeField], id: record.params?.[idField] }));
    const found = await loadPolymorphicTargets(pool, refs);
    records.forEach((record, index) => {
      const { type, id } = refs[index];
      if (!id) return;
      const resourceId = polymorphicResourceId(type);
      const row = found.get(`${type}:${id}`) ?? null;
      record.populated = {
        ...record.populated,
        [idField]: { id, resourceId, missing: Boolean(resourceId) && !row, params: row ?? {} },
      };
    });
    return response;
  };
}
