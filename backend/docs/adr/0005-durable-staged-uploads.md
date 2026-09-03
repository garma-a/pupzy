# 0005: Durable Staged Upload Foundation for Media Lifecycle

- **Status:** Accepted
- **Date:** 2026-09-04
- **Context:** Mobile clients upload images in a two-phase flow: requesting a presigned PUT URL for Cloudflare R2 staging, uploading bytes from the device, and attaching the resulting `mediaId`s when creating an entity (such as a Post or Comment). Previously, staging ticket state and ownership were stored purely in process-local cache (`CacheManager`). Server restarts, process recycling, or deployments caused immediate cache loss, rendering valid in-flight uploads unusable and failing post creation even though the image was successfully transferred to R2.

---

## Decision

We establish **PostgreSQL as the sole authoritative state machine** for media upload tickets via the `staged_uploads` table, making process-local cache an optional acceleration layer only.

### 1. Database-Backed Lifecycle State Machine

Upload capabilities are tracked across four explicit states:
- `ISSUED`: Created durably in PostgreSQL before the presigned PUT URL is handed to the client. Bound to the authenticated owner (`user_id`), target domain (`purpose`, e.g., `POST_MEDIA`, `COMMENT_IMAGE`), declared content type, file size, opaque staging key, and a 15-minute expiration timestamp.
- `CLAIMED`: Atomically bound to a target entity (`post_id`) upon validation. An atomic conditional update (`UPDATE staged_uploads SET status = 'CLAIMED', post_id = $1 WHERE id = $2 AND user_id = $3 AND status = 'ISSUED' AND expires_at > now() RETURNING *`) guarantees single-use semantics under concurrent creation requests without holding open long database locks.
- `FINALIZED`: Marked upon successful byte relocation in R2 from `staging/` to `posts/{postId}/{mediaId}.{ext}`. Records `final_storage_key`.
- `FAILED`: Recorded if object verification or R2 finalization fails, or if post creation database transaction fails, permanently marking the staged ticket unusable.

### 2. Client Compatibility & Zero-Disruption Contract

- The GraphQL schema, query/mutation names (`requestMediaUpload`), argument types, nullability, validation boundaries, and response structures remain strictly identical.
- Flutter mobile clients require zero code changes or migration coordination.
- Existing posts and existing media in `post_media` remain fully readable and valid without rewriting public CDN URLs or storage keys.

### 3. Separation of Network I/O and Database Transactions

- Network operations against Cloudflare R2 (`HeadObjectCommand`, `CopyObjectCommand`, `DeleteObjectCommand`) are executed **outside** any open PostgreSQL transaction.
- Media finalization runs before the post entity is persisted and returned. If finalization fails, the operation fails fast and cleanly without persisting a broken post referencing unready media.
- If post entity creation fails, `markMediaFailed` marks the tickets `FAILED` durably.

### 4. Cache Decoupling and Restart Resilience

- Cache loss during shutdown, restart, or rolling deployment requires no flush, leaves no orphaned database capabilities, and cannot invalidate a valid unexpired ticket.
- When cache entries are missing, queries immediately and transparently resolve against PostgreSQL.
- Authorization and existence masking: looking up an invalid ticket—whether non-existent, belonging to another user, bearing the wrong purpose, expired, or already consumed—consistently throws `NotFoundError('Staged media', mediaId)` without leaking existence, ownership, or status details.

---

## Consequences

### Positive
- **Fault-tolerant mobile uploads:** In-flight uploads survive API server redeployments and container restarts.
- **Race condition protection:** Atomic single-use claim prevents media reuse or double-binding across concurrent requests.
- **Strict entity safety:** Posts cannot be created with unready, corrupted, or broken media.
- **Extensibility:** Provides a solid, reusable foundation for comment images and future media-upload flows without re-implementing upload lifecycle logic.

### Trade-offs & Mitigations
- **Database Write on Presigned URL Request:** Generating an upload URL performs an `INSERT` into `staged_uploads`. Mitigated by lightweight row structure, indexed lookups, and bounded expiry cleanup.
