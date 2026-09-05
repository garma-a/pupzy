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

## 2. In-Process Staging Cleanup & Lifecycle Failsafe

### 2.1 In-Process Hourly Cleanup Cron
- **Component:** `StagingCleanupCron` in `backend/src/upload/staging-cleanup.cron.ts`.
- **Schedule:** `@Cron(CronExpression.EVERY_HOUR)` inside the Main NestJS API container.
- **Action:** Queries `staged_uploads` for records with `status IN ('ISSUED', 'CLAIMED')` and `expires_at < NOW()`.
- **Cleanup:** Deletes orphaned objects from Cloudflare R2 staging prefix (`staging/{userId}/{mediaId}`) and marks database records as `EXPIRED`.
- **Memory & Latency Safety:** Batched in chunks of 50 objects per iteration; does not block request processing or spike RSS memory.

### 2.2 Cloudflare R2 1-Day Lifecycle Rule (Failsafe)
- Cloudflare R2 bucket `staging/` prefix is configured with an automated **1-day object expiration lifecycle rule**.
- If the NestJS API restarts during a cleanup iteration or experiences network degradation reaching R2, Cloudflare's native lifecycle rule guarantees eventual garbage collection of abandoned staging objects at zero compute cost.

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
