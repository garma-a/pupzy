import { inArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { cities, posts } from '../database/schema';
import type * as schema from '../database/schema';

/**
 * The normalized Post search-document expression shared by every searchable
 * feed (Home, help, adopt, market and mating).
 *
 * It is matched against the same expression that `idx_posts_search_document_trgm`
 * indexes — title, description, area name and market category — so stored and
 * query text use one normalization and the trigram index stays usable.
 */
export function buildFeedSearchDocumentExpression(): SQL {
  return sql`pupzy_search_normalize(
    ${posts.title} || ' ' || ${posts.description} || ' ' || COALESCE(${posts.areaName}, '') || ' ' ||
    COALESCE(pupzy_search_enum_text(${posts.marketCategory}), '')
  )`;
}

/**
 * Builds the optional server-side search condition shared by every searchable
 * feed.
 *
 * The submitted `searchPattern` is already normalized and LIKE-escaped by
 * `buildFeedSearchPattern`. City names live on `cities`, a separate relation,
 * so matching Cities are resolved first through their own normalized trigram
 * indexes and applied as an indexable `city_id = ANY(...)` branch. That keeps
 * the whole predicate eligible for a BitmapOr instead of forcing a sequential
 * scan.
 *
 * The condition is a pure filter: callers keep their own ordering, cursor and
 * lifecycle/isolation predicates, so search never re-ranks a feed. This is the
 * single implementation used by all five feeds, so their match semantics
 * cannot drift apart.
 */
export async function buildFeedSearchCondition(
  db: NodePgDatabase<typeof schema>,
  searchPattern: string | null | undefined,
): Promise<SQL | undefined> {
  if (!searchPattern) return undefined;

  const matchingCities = await db
    .select({ id: cities.id })
    .from(cities)
    .where(
      or(
        sql`pupzy_search_normalize(${cities.nameEnglish}) LIKE ${searchPattern}`,
        sql`pupzy_search_normalize(${cities.nameArabic}) LIKE ${searchPattern}`,
      ),
    );

  return or(
    sql`${buildFeedSearchDocumentExpression()} LIKE ${searchPattern}`,
    matchingCities.length > 0
      ? inArray(
          posts.cityId,
          matchingCities.map((city) => city.id),
        )
      : undefined,
  )!;
}
