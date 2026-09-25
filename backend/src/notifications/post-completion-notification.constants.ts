/**
 * Shared tuning for durable post completion notification delivery.
 *
 * The processor and repository both bound their work by the same attempt
 * limit: the repository reclaims a PROCESSING row only while attempts remain
 * and marks an interrupted max-attempt lease FAILED, so a crashed worker can
 * never leave a recipient stranded outside the claim predicate.
 */
export const POST_COMPLETION_BATCH_SIZE = 50;
export const POST_COMPLETION_LEASE_MS = 60_000;
export const MAX_RETRY_DELAY_MS = 5 * 60_000;
export const MAX_COMPLETION_DELIVERY_ATTEMPTS = 5;
