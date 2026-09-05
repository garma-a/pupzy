# Comments & Discussion Images Operational Runbook

This runbook defines the operational controls, failure recovery procedures, moderation workflows, and scale policies for the Comments & Images discussion feature on Pupzy's three-service Railway Hobby architecture.

---

## 1. System Topology & Zero-Worker Architecture

The entire Comments & Images feature operates strictly within the existing **three-service deployment topology**:
1. **PostgreSQL (Continuous):** Holds tables `comments`, `comment_media`, `post_pins`, `comment_reports`, `staged_uploads`, `media_deletion_work`, and `blocked_media_hashes`.
2. **Main NestJS API (Continuous):** Serves client GraphQL traffic, validates WebP uploads, hosts in-process cron reconcilers (`StagingCleanupCron`, `MediaDeletionProcessor`), and coordinates notifications.
3. **AdminJS Service (Serverless Sleep):** Provides back-office review for comments, comment reports, and blocked image hashes.

> **CRITICAL:** No Redis instance, standalone background worker container, queue daemon, or 4th Railway service is deployed or permitted.

---

## 2. Media Publishing Recovery & Reconciliation Lifecycle (Ticket 04)

### 2.1 Continuous & Restart-Time Recovery
- **Component:** `MediaDeletionProcessor` in `backend/src/upload/media-deletion.processor.ts`.
- **Zero-Fourth-Service Topology:** Runs completely inside the main continuously available NestJS API without requiring Redis, a separate scheduler daemon, or a 4th Railway service.
- **Startup Reconciliation:** Implements `OnApplicationBootstrap` to run `reconcile()` immediately when the application starts up or restarts following a deployment, crash, or OOM event.
- **Periodic Reconciliation:** Annotated with `@Cron(CronExpression.EVERY_5_MINUTES)` to continuously detect and heal interrupted operations in the background.

### 2.2 Recoverable Failure States
1. **Copied-but-uncommitted State:**
   - *Condition:* `staged_uploads` with `purpose = 'COMMENT_IMAGE'`, `finalStorageKey IS NOT NULL`, `status IN ('CLAIMED', 'FINALIZED', 'FAILED')`, and `updatedAt < NOW() - 5 minutes`, where no corresponding row exists in `comment_media`.
   - *Resolution:* The object was published to R2 or claimed, but comment creation never committed (e.g. database commit crash, validation abort, or API crash).
   - *Action:* Atomically transitions `status = 'FAILED'` using conditional update `WHERE id = $1 AND status = $2 RETURNING *`. Enqueues durable storage deletion and CDN purge tasks in `media_deletion_work` for `finalStorageKey`. Deletes the staging object from R2 and marks `stagingKey = cleaned/...`.
2. **Committed-but-not-cleaned State:**
   - *Condition:* `staged_uploads` with `status = 'FINALIZED'`, `finalStorageKey IS NOT NULL`, and `updatedAt < NOW() - 5 minutes`, where `comment_media` DOES contain a matching row.
   - *Resolution:* Comment creation succeeded and committed to PostgreSQL, but staging deletion in R2 was interrupted before completion.
   - *Action:* Confirms the active comment attachment. Safely deletes the original staging object (`stagingKey`) from R2 and updates `stagingKey = cleaned/...` to prevent redundant checks while leaving the public finalized object completely intact.
3. **Expired or Abandoned Staging:**
   - *Condition:* `staged_uploads` with `status IN ('ISSUED', 'CLAIMED')` where `expiresAt < NOW()`, or `status = 'FAILED'` older than 5 minutes that has not yet been cleaned.
   - *Action:* Deletes the staging object from R2 (queuing to `media_deletion_work` if delete fails) and marks `status = 'EXPIRED'`, setting `stagingKey = cleaned/...`.
4. **Committed Media Protection Guard (AC 6):**
   - In `MediaDeletionProcessor.processPendingWork()`, before deleting any R2 object, the worker checks if `comment_media` contains a row referencing the target storage key.
   - If a committed record exists, deletion is safely bypassed and marked `COMPLETED` with note `Skipped: media is committed to comment`, preventing stale worker races from deleting live user content.

### 2.3 Cloudflare R2 1-Day Lifecycle Rule (Failsafe)
- Cloudflare R2 bucket `staging/` prefix is configured with an automated **1-day object expiration lifecycle rule**.
- If the NestJS API restarts during a cleanup iteration or experiences network degradation reaching R2, Cloudflare's native lifecycle rule guarantees eventual garbage collection of abandoned staging objects at zero compute cost.

### 2.4 Operator Inspection & Historical Recovery Queries
Operators can monitor interrupted tickets and verify convergence using the following queries:

```sql
-- Inspect uncommitted or interrupted staged uploads older than 5 minutes
SELECT id, user_id, status, post_id, staging_key, final_storage_key, updated_at
FROM staged_uploads
WHERE purpose = 'COMMENT_IMAGE'
  AND final_storage_key IS NOT NULL
  AND updated_at < NOW() - INTERVAL '5 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM comment_media WHERE storage_key = staged_uploads.final_storage_key
  );

-- Inspect committed uploads awaiting staging cleanup
SELECT id, user_id, status, staging_key, final_storage_key, updated_at
FROM staged_uploads
WHERE purpose = 'COMMENT_IMAGE'
  AND status = 'FINALIZED'
  AND staging_key NOT LIKE 'cleaned/%'
  AND EXISTS (
    SELECT 1 FROM comment_media WHERE storage_key = staged_uploads.final_storage_key
  );

-- Manual trigger of reconciliation (via processor.reconcile() in container or SQL reset)
-- Resetting stuck CLAIMED rows older than 15 minutes to FAILED if uncommitted:
UPDATE staged_uploads
SET status = 'FAILED', error_message = 'Manual operator reconciliation', updated_at = NOW()
WHERE purpose = 'COMMENT_IMAGE'
  AND status = 'CLAIMED'
  AND updated_at < NOW() - INTERVAL '15 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM comment_media WHERE storage_key = staged_uploads.final_storage_key
  );
```

---

## 3. Media Deletion Outbox & CDN Purge Backlog

### 3.1 Durable Deletion Outbox Pattern
- When a user deletes a comment containing media or an administrator permanently removes a comment (`removeComment`), public media rows are immediately unlinked and records are committed to `media_deletion_work` within the same database transaction.
- **Processor:** `MediaDeletionProcessor` in `backend/src/upload/media-deletion.processor.ts` runs every minute (`@Cron(CronExpression.EVERY_MINUTE)`).
- **Execution & Idempotency:**
  1. Atomically claims batches of up to 50 `PENDING` work items (or `PROCESSING` items stuck for > 5 minutes) using an atomic `UPDATE ... RETURNING *` conditional query to prevent worker races.
  2. Deletes finalized R2 object (`comments/{commentId}/{mediaId}.webp`) via real storage client. Deletions are idempotent.
  3. Sends CDN cache purge request to Cloudflare Zone API. CDN purges are idempotent.
  4. Conditionally marks work item `COMPLETED` only if both R2 deletion and CDN purge succeeded.
- **Error Propagation (Spec 4 & Spec 15):**
  - Storage deletion errors and CDN purge errors (network failures, timeouts, Cloudflare error responses, or missing Cloudflare credentials) are never swallowed.
  - Work is never marked `COMPLETED` because an exception was caught or logged; exceptions propagate back to the processor loop.
  - Missing Cloudflare credentials (`CLOUDFLARE_ZONE_ID` or `CLOUDFLARE_API_TOKEN`) fail loudly as observable operational errors rather than simulating success.

### 3.2 Delivery Policy & Domain Transitions
- Deletion outbox records match the configured media delivery policy:
  - **Primary CDN domain:** `https://cdn.pupzy.net` by default.
  - **Explicit fallback / override:** `COMMENT_MEDIA_CDN_BASE` or `R2_PUBLIC_URL`.
  - **Domain transitions:** When `COMMENT_MEDIA_DOMAIN_TRANSITION=true` or `COMMENT_MEDIA_PREVIOUS_CDN_BASE` is configured, permanent removal queues purge tasks for both the current active CDN URL and any legacy/fallback CDN URLs to ensure cached copies do not outlive removal.

### 3.3 Backlog Inspection & Operator Retry Policy
- **Transient Failures:** Work items retry with exponential backoff up to 5 attempts. While `attempts < 5`, the status is reset to `PENDING` with `last_error` recorded.
- **Persistent Failures:** After 5 failed attempts, the record transitions to `FAILED` with `last_error` recorded, retaining work for operator intervention.
- **Operator Inspection Queries:**
  ```sql
  -- Inspect failed work requiring operator intervention
  SELECT id, storage_key, cdn_url, attempts, last_error, updated_at
  FROM media_deletion_work
  WHERE status = 'FAILED'
  ORDER BY updated_at DESC;

  -- Inspect stuck or in-flight processing items
  SELECT id, storage_key, cdn_url, attempts, updated_at
  FROM media_deletion_work
  WHERE status = 'PROCESSING'
  ORDER BY updated_at ASC;

  -- Backlog volume summary
  SELECT status, count(*)
  FROM media_deletion_work
  GROUP BY status;
  ```
- **Configuration Repair:**
  - If `last_error` indicates `Cloudflare credentials missing`, configure `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` in the Railway environment.
  - If `last_error` indicates R2 authentication or bucket access failure, check `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_ENDPOINT`.
- **Operator Remediation / Retry Procedure:**
  Once storage or CDN configuration and connectivity are restored, operators can re-queue failed items:
  ```sql
  UPDATE media_deletion_work
  SET status = 'PENDING', attempts = 0, last_error = NULL, updated_at = NOW()
  WHERE status = 'FAILED';
  ```

---

## 4. Moderation & Exact-Hash Blocklist (AdminJS)

### 4.1 Actions Available in AdminJS
Moderators navigate to the `Comments` and `Comment Reports` resources in AdminJS:
1. **Restore Comment (`restoreComment`):** Restores visibility of a comment currently in `IMAGE_HIDDEN` or `HIDDEN` status back to `ACTIVE`.
2. **Permanent Removal (`removeComment`):** Transitions comment to `REMOVED`. Masks text as `[Removed]`, unlinks author, unpins if pinned, unlinks media, and transactionally enqueues R2 deletion and CDN purge tasks to `media_deletion_work`.
3. **Block Image Hash:** If a comment is removed for inappropriate content, the image SHA-256 digest is transactionally added to `blocked_media_hashes`.

### 4.2 Temporary Hiding vs. Permanent Removal
- **Temporary Hiding (Automated Reports or Review):**
  - Triggered automatically by report thresholds (e.g. 1 qualifying inappropriate report sets status to `IMAGE_HIDDEN`; 3 qualifying reports set status to `HIDDEN`).
  - Hides media URLs from GraphQL query responses while keeping the database records and underlying R2 storage intact so comments/media can be restored if reports are invalidated.
  - **Accepted Limitation:** Temporary hiding does not revoke or purge previously copied or cached public URLs.
- **Permanent Removal (Author Deletion or AdminJS `removeComment`):**
  - Permanently removes the comment and unlinks media.
  - Transactionally enqueues storage deletion and CDN purges across all relevant domains.
  - Guarantees that permanent removal does not claim completion before its required deletion and purge effects succeed.

### 4.3 Exact-Hash Limitations
- The blocklist stores cryptographic **SHA-256 digests**.
- It matches images **bit-for-bit**. It is **not a perceptual or fuzzy hash**.
- A single pixel change, re-compression, or metadata modification produces a distinct SHA-256 hash. Moderators must rely on comment reporting and manual review for variant or altered abusive imagery.

---

## 5. Operational Rollback & Kill-Switch (`COMMENT_IMAGES_ENABLED`)

If abusive image flooding, storage anomalies, or R2 outages occur:
1. Set Railway environment variable in `Main NestJS API`:
   ```env
   COMMENT_IMAGES_ENABLED=false
   ```
2. **Immediate Effect:**
   - `requestCommentImageUploadUrl` mutation immediately rejects new upload requests with `COMMENT_IMAGES_DISABLED`.
   - Existing comments and images remain fully readable and browsable.
   - Text comment creation, replies, boosts, pins, and reporting continue functioning without interruption.
   - No database schema rollback or redeployment of previous versions is required.

---

## 6. Railway Hobby vs. Pro Scaling Policy

- **Launch Configuration:** 1 NestJS API replica (512 MB RAM, 1 vCPU, 150 MB V8 heap), 1 PostgreSQL instance (1 GB RAM, 1 vCPU), 1 AdminJS replica (Serverless sleep, 512 MB RAM, 256 MB V8 heap).
- **Scale Limits:** Sustains 100 req/sec steady and 200 req/sec burst under normal read/write distribution.
- **Pro Plan Transition:** Upgrading to Railway Pro ($20/mo base) remains a manual operator decision. Never trigger automatic plan transitions based on user registration counts.
