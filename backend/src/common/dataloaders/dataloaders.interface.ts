import DataLoader from 'dataloader';
import type { City } from '../../database/schema';

/**
 * DataLoaders bag — one instance per GraphQL request.
 *
 * Created fresh per request in the GraphQLModule context factory so each
 * request gets its own cache, preventing cross-request data leaks.
 *
 * ## Why DataLoader?
 * Without DataLoaders, fetching `city` on a list of users would fire one
 * SELECT per user (N+1 problem). DataLoader batches all city-ID lookups
 * within a single event-loop tick into a single `WHERE id = ANY($1)` query.
 *
 * ## Lifecycle
 * Each DataLoader instance is created per-request by `createDataLoaders()`.
 * It is injected into the GQL context and consumed by field resolvers.
 */
export interface DataLoaders {
  /** Batch-loads City rows by UUID. Returns `null` for unknown IDs. */
  cityById: DataLoader<string, City | null>;
}
