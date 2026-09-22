# Feed Search Flutter Integration Contract

This document is the authoritative client contract for the optional server-side `search` argument on all five discovery feeds: Home (`homeFeed`), help discovery (`helpFeed`), Adopt (`adoptFeed`), Market (`marketFeed`) and Mating (`matingFeed`). It covers the argument, its normalization and bounds, the preserved feed behavior, and the stable error codes. The normalization source of truth is the `pupzy_search_normalize` database function (migration `0052_add_normalized_feed_search`) with its query-side twin in `src/posts/search-query.util.ts`.

Ticket 15 introduced the contract on `homeFeed` and `helpFeed`; ticket 16 extends the same tested implementation (`src/posts/feed-search.sql.ts`) to `adoptFeed`, `marketFeed` and `matingFeed`. Every feed shares one search condition, so match semantics cannot drift between them.

---

## 1. Operation shape (additive and backward compatible)

`search: String` is an optional argument on all five feeds. Omitting it (or sending `null`) produces exactly the pre-search feed. No existing argument, field, ordering or error changed.

```graphql
query HomeFeed(
  $governorate: String
  $cityId: ID
  $viewerLocation: ViewerLocationInput
  $radiusKm: Float
  $search: String
  $first: Int
  $after: String
) {
  homeFeed(
    governorate: $governorate
    cityId: $cityId
    viewerLocation: $viewerLocation
    radiusKm: $radiusKm
    search: $search
    first: $first
    after: $after
  ) {
    edges {
      node {
        id
      }
      cursor
      distanceKm
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

`helpFeed`, `adoptFeed` and `marketFeed` accept the identical optional `search: String` argument in addition to their existing arguments (`sort` on adopt/market, `category` on market). `matingFeed` accepts it alongside its existing `filter`, `first` and `after` arguments:

```graphql
query MatingFeed($filter: MatingFeedFilter, $search: String, $first: Int, $after: String) {
  matingFeed(filter: $filter, search: $search, first: $first, after: $after) {
    edges {
      node {
        id
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## 2. What search matches

Search is a server-side filter over the Post's normalized search document:

| Source           | Notes                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `title`          | Post headline.                                                            |
| `description`    | Post body.                                                                |
| `marketCategory` | Product category enum text, e.g. `FOOD`; only Products carry a category.  |
| `areaName`       | Optional neighborhood label, e.g. `Maadi`.                                |
| City names       | The Post's City `nameEnglish` and `nameArabic`, e.g. `Cairo` / `القاهرة`. |

The query is matched as a literal substring (`%…%`) of the normalized text. `%`, `_` and `\` in the submitted text match themselves; they are not wildcards.

Mating-specific values such as `petName`, `breed`, `species` and `gender` live on the `mating_posts` extension table and are **not** part of the shared search document. On `matingFeed`, `filter.breed` remains the existing case-insensitive partial match for breed text; `search` and every `filter` predicate apply together.

## 3. Normalization

One normalization is applied to the stored Post/City text and to the submitted query text, so English/Arabic variants match consistently:

- Lowercasing.
- Arabic diacritics (harakat) and tatweel are removed: `كَلب` and `كـــلب` both become `كلب`.
- Alef variants `أ إ آ ٱ` become `ا`: `أحمد` matches `احمد`.
- Yeh variants `ى ئ` become `ي`: `المعادى` matches `المعادي`.
- `ؤ` becomes `و`.
- Teh marbuta `ة` becomes `ه`: `القاهرة` matches `القاهره`.
- Whitespace runs collapse to one space and the text is trimmed: `"  lost   dog "` matches `Lost    Dog`.

## 4. Documented short, empty and oversize behavior

The same behavior applies to every feed:

| Submitted `search`                                                    | Behavior                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Omitted or `null`                                                     | No search; the feed is unchanged.                                           |
| `""` or whitespace only                                               | No search; the feed is unchanged.                                           |
| Text that normalizes to nothing (for example diacritics only, `"ًَ"`) | No search; the feed is unchanged.                                           |
| Normalizes to fewer than 2 characters, e.g. `"x"`                     | Rejected with `VALIDATION_ERROR` (`search must be at least 2 characters`).  |
| More than 100 characters after trimming                               | Rejected with `VALIDATION_ERROR` (`search must be at most 100 characters`). |
| 2–100 characters                                                      | Search filter applied.                                                      |

Two-character queries are accepted but cannot use the trigram index as effectively as longer text, so they may scan more rows than a longer, selective query.

## 5. Preserved feed behavior

Search is a filter, never a re-ranking or a client-page filter. Each feed keeps its own ordering, filters and opaque keyset cursors, and `after` continues to work with search applied without duplicate or skipped rows:

| Feed        | Ordering (unchanged)                                             | Filters retained alongside `search`                                     |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `homeFeed`  | Newest first (`id DESC`).                                        | `governorate`, `cityId`, `viewerLocation` + `radiusKm`.                 |
| `helpFeed`  | `urgency ASC, created_at DESC, id DESC`.                         | `governorate`, `cityId`, `viewerLocation` + `radiusKm`.                 |
| `adoptFeed` | `HOT` (default): score `DESC, created_at DESC, id DESC`; `NEWEST`: `id DESC`. | `governorate`, `cityId`, `viewerLocation` + `radiusKm`. |
| `marketFeed`| `HOT` (default): score `DESC, created_at DESC, id DESC`; `NEWEST`: `id DESC`. | `governorate`, `cityId`, `viewerLocation` + `radiusKm`, `category`. |
| `matingFeed`| `created_at DESC, id DESC`.                                      | `filter.species`, `filter.gender`, `filter.breed`, `filter.cityId`.     |

Shared guarantees:

- **Ordering is unchanged by search.** Matches that would appear on later pages are found without loading earlier pages.
- **Cursor pagination is unchanged.** `edges[].cursor` / `pageInfo.endCursor` remain opaque keyset cursors built from the same ordering columns.
- **Existing filters are retained and compose with search.** A search request applies the feed's predicates first-class in SQL, never as a post-filter.
- **Isolation and lifecycle are retained.** A viewer's Blocks hide matching Posts in either direction, and only `ACTIVE` Posts are discoverable: resolved/reunited/adopted/sold (`RESOLVED`, `REUNITED`, `ADOPTED`, `SOLD`), expiring (`EXPIRED`) and removed (`REMOVED`) Posts never appear in search results. `matingFeed` additionally requires its `mating_posts` extension row.
- **No new relevance ranking.** Results are the feed's own ordered subset of matching Posts; boosts, recency and effective score are not used to rank search matches.

## 6. Errors

| Error code         | When                                           | Client behavior                                                 |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| `VALIDATION_ERROR` | `search` normalizes to fewer than 2 characters | Keep the local minimum length at 2; do not submit shorter text. |
| `VALIDATION_ERROR` | `search` exceeds 100 characters after trimming | Enforce a local 100-character maximum.                          |

The feed connection itself is unchanged; on validation failure the standard GraphQL error is returned and no partially filtered page is produced.

## 7. Storage and index notes

- `pupzy_search_normalize(text)` is an `IMMUTABLE` SQL function used by both the stored expression index and the submitted query text.
- `idx_posts_search_document_trgm` is a partial GIN trigram index on the normalized search document for `status = 'ACTIVE'` Posts, matching every searchable feed's lifecycle predicate — including the specialist feeds added by ticket 16; no additional migration is required.
- `idx_cities_search_name_english_trgm` and `idx_cities_search_name_arabic_trgm` are GIN trigram indexes used to resolve matching Cities, which are then applied as an indexable `city_id` branch.
- Automated query-plan evidence (`src/posts/posts-search.integration.spec.ts`) shows all five feeds filtering in SQL through `idx_posts_search_document_trgm` while the feed's `Limit` still receives a full page of viewer-visible rows. A further assertion captures the generated search document expression from each feed and requires it to be identical, so no feed can grow its own drifted copy of the condition.
- Deployment ordering: migration `0052_add_normalized_feed_search` creates `pg_trgm`, the normalization functions and the trigram indexes. It is additive, so running it with the previous service version is safe; the new service must run migrations before it serves search requests. Requests without `search` never touch the new functions or indexes.
