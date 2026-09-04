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
- When a user deletes a comment containing media, the public media row is immediately unlinked and records are committed to `media_deletion_work` within the same database transaction.
- **Processor:** `MediaDeletionProcessor` in `backend/src/upload/media-deletion.processor.ts` runs hourly.
- **Execution:**
  1. Claims batches of up to 50 `PENDING` work items.
  2. Deletes finalized R2 object (`comments/{commentId}/{mediaId}.webp`).
  3. Sends CDN cache purge request to Cloudflare Zone API.
  4. Marks work item `COMPLETED`.

### 3.2 Backlog & Retry Policy
- **Transient Failures:** Work items retry with exponential backoff up to 5 attempts.
- **Persistent Failures:** After 5 failed attempts, the record transitions to `FAILED` with `last_error` recorded.
- **Operator Inspection Query:**
  ```sql
  SELECT id, storage_key, cdn_url, attempts, last_error, updated_at
  FROM media_deletion_work
  WHERE status = 'FAILED'
  ORDER BY updated_at DESC;
  ```
- **Operator Remediation:** Once storage or CDN connectivity is restored, operators can re-queue failed items:
  ```sql
  UPDATE media_deletion_work
  SET status = 'PENDING', attempts = 0, last_error = NULL
  WHERE status = 'FAILED';
  ```

---

## 4. Moderation & Exact-Hash Blocklist (AdminJS)

### 4.1 Actions Available in AdminJS
Moderators navigate to the `Comments` and `Comment Reports` resources in AdminJS:
1. **Hide Image Only (`hideImage`):** Transitions comment to `IMAGE_HIDDEN`. Strips public media access while keeping text readable. Queues media deletion work.
2. **Hide Entire Comment (`hideComment`):** Transitions comment to `HIDDEN`. Masks text as `[Hidden]`, unlinks author as anonymous `null`, unpins if pinned, and strips media.
3. **Remove Comment (`removeComment`):** Transitions comment to `REMOVED`. Masks text as `[Removed]`, unlinks author as anonymous `null`, unpins if pinned, and strips media.
4. **Block Image Hash (`blockImageHash`):** Calculates/records SHA-256 in `blocked_media_hashes`. Prevents this exact binary from ever being attached to future comments.

### 4.2 Exact-Hash Limitations
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
