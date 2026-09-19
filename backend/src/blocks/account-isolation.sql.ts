import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { blocks } from '../database/schema';

/**
 * Database predicate that keeps only rows whose author account is not isolated
 * from the viewer by an active Block in either direction.
 *
 * The anti-join subquery is uncorrelated, so PostgreSQL evaluates it once per
 * query rather than once per candidate row — no N+1 pair checks. Callers place
 * it inside the same `where()` as their other conditions, before keyset cursor
 * predicates and `limit()`, so filtered pages stay dense and `hasNextPage`
 * reflects the viewer-visible set.
 *
 * Returns `undefined` for anonymous viewers so `and()` silently drops the
 * condition, leaving public reads unfiltered.
 */
export function excludeIsolatedAccounts(viewerId: string | null | undefined, accountId: SQLWrapper): SQL | undefined {
  if (!viewerId) return undefined;
  return sql`${accountId} NOT IN (
    SELECT ${blocks.blockedId} FROM ${blocks} WHERE ${blocks.blockerId} = ${viewerId}
    UNION
    SELECT ${blocks.blockerId} FROM ${blocks} WHERE ${blocks.blockedId} = ${viewerId}
  )`;
}
