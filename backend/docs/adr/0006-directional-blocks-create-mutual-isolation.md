# 0006: Directional Blocks Create Mutual Isolation

- **Status:** Accepted
- **Date:** 2026-09-19
- **Context:** Pupzy had no personal safety boundary. A person could not stop a specific Pupzy Account from discovering their Posts, joining their discussions, sending Contact Requests or Adoption Applications, retrieving their contact information, or generating notifications. Apple Guideline 1.2 and Google Play's User Generated Content policy expect in-app reporting **and** blocking, and administrative moderation alone is reactive. We needed an immediate, reversible, privacy-preserving relationship that closes the gap without rewriting the Flutter client or exposing who blocked whom.

---

## Decision

We introduce a **Block**: a reversible safety relationship stored directionally, owned by the initiating Pupzy Account, whose product effect is **mutual isolation** between the two accounts. Reports and Blocks remain entirely distinct actions, and the client-facing surface is additive (`blockUser`, `unblockUser`, `blockedUsers`).

### 1. Directional ownership, mutual effect

- A row in `blocks` records `blocker_id`, `blocked_id`, and `created_at`, with a uniqueness constraint on the ordered pair, foreign keys to `users` cascading on Account Deletion, and a database constraint prohibiting self-Blocking.
- Only the account that created a Block can remove it. The other party cannot defeat the decision.
- While a Block is active in **either** direction, mutual isolation applies to all user-facing behavior: discovery, direct retrieval, discussion, personalized counts, engagement, direct interaction, contact disclosure, and notifications.
- The relationship is not a one-way mute. A directional row avoids conflating "who acted" with "what is hidden", so Unblock authority stays with the decision owner while the blocked party cannot continue observing the blocker.

### 2. Enforced server-side at the database predicate level

- Read isolation is applied in SQL predicates through the account-isolation policy and `excludeIsolatedAccounts` helper, before pagination limits, cursor evaluation, and `hasNextPage` calculation, so keyset feeds and discussion pages do not degrade into sparsely post-filtered pages.
- Write isolation is rechecked inside the committing transaction for Comments, Replies, engagement, Contact Requests, Adoption Applications, approvals, and contact disclosure.
- `blockUser` acquires a canonical undirected account-pair serialization lock, inserts the Block, and rejects every pending Contact Request and Adoption Application between the pair **in one transaction before returning**. If an interaction commits first, the following Block hides and rejects it where applicable; if the Block commits first, the interaction fails. No new cross-Block interaction can commit after `blockUser` succeeds.
- Cross-account operations acquire pair locks in a deterministic canonical-key order before existing Post/discussion locks to prevent deadlocks.

### 3. Neutral, direction-free responses

- Lists omit blocked records; nullable direct queries return `null`; other reads and writes reuse the existing not-found/unavailable behavior. No public error reveals that a Block exists or which account created it.
- Block, Unblock, and Report never notify the other party.
- Blocked Accounts (`blockedUsers`) is viewer-scoped, cursor-paginated newest-first, and exposes only minimal display identity, the Block timestamp, and an opaque cursor.

### 4. Preservation, not destruction

- Existing Upvotes, Saves, and Boosts are preserved internally; viewer-specific booleans resolve `false` while blocked and restore after Unblock.
- Pending Contact Requests and Adoption Applications are preserved as audit records but omitted from both parties' lists and cannot be approved after Blocking. Unblock does **not** reopen them or bypass same-Post uniqueness.
- Historical notifications are retained. New notifications, including delayed discussion-notification delivery, are suppressed and the durable event is marked terminal so it does not retry forever.
- Account Deletion cascade-deletes Blocks and open Reports involving the deleted account; completed moderation decisions survive only as redacted append-only audit history.

### 5. Administrative bypass

- Blocks never filter admin-service resources, dashboards, report context, moderation queues, or moderation actions. Authorized administrators can inspect both accounts, their content, direct-interaction records, Reports, and audit history.

---

## Alternatives Considered

- **Fully symmetric Block (both parties own the removal):** rejected because it lets the reported/blocked party unilaterally reverse the other person's safety decision.
- **One-way mute (only the initiator stops seeing the other):** rejected because the blocked account could keep discovering content, commenting, requesting contact, and generating notifications — failing the immediate-protection goal and store expectations.
- **Soft "hide" flags applied ad hoc per resolver:** rejected because a missed surface would leak interaction or observation, and pagination would post-filter. A single policy seam with SQL predicates and transactional rechecks is auditable and complete.
- **Public Block state or a Block-revealing error:** rejected as retaliation and privacy risk; neutral unavailable behavior leaks less and matches existing inaccessible-content handling.

---

## Consequences

- **Positive:**
  - Users gain immediate, reversible personal protection without waiting for administrative action.
  - Reporting and Blocking remain separable, so asking for review never silently changes a relationship.
  - The directional row preserves ownership while the mutual effect protects the initiator.
  - Neutral responses and retained audit records keep the feature privacy-preserving and moderation-friendly.
  - Additive GraphQL operations keep the existing Flutter application compiling and behaving normally when no Block applies.

- **Trade-offs & Mitigations:**
  - Every user-facing read and cross-account write must consult the isolation policy; a missed surface becomes a safety bug. Mitigated by the shared policy seam, SQL helper, deterministic pair locking, and dedicated visibility/interaction matrix tests.
  - Pair serialization adds one advisory lock to cross-account writes; accepted as bounded and necessary for the completion guarantee, with deterministic multi-pair ordering to avoid deadlocks.
  - Preserved engagement and rejected requests can look surprising after Unblock; mitigated by explicitly *not* reopening rejected interactions and by documenting the behavior in the Flutter integration contract.
  - Account pairs can only ever hold at most one directional relationship per direction; repeated Block/Unblock is idempotent and safe to retry.

## References

- Spec: `.scratch/ugc-reporting-and-account-blocking/spec.md` — Implementation Decisions "Block persistence", "Block semantics", "Block API", "Blocked Accounts API", "Concurrency boundary", "Block completion guarantee", "Privacy-preserving errors", "Unblocking".
- Flutter contract: `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md`.
- Release evidence: `docs/ugc-reporting-and-account-blocking-release-evidence.md`.
