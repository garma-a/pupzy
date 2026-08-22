/**
 * Clamps a GraphQL `first` argument to a safe integer.
 * - Negative values cause SQL "LIMIT must not be negative" (500).
 * - Zero returns an empty page with hasNextPage=true (client infinite loop).
 * Both are treated as 1. Upper bound caps expensive queries.
 */
export function clampFirst(first: number | null | undefined, fallback = 20, max = 50): number {
  const n = typeof first === 'number' && Number.isFinite(first) ? Math.floor(first) : fallback;
  return Math.min(Math.max(n, 1), max);
}
