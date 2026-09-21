# 0007: Retire Saved-Search Runtime Before Storage Contraction

- **Status:** Accepted
- **Date:** 2026-09-21
- **Context:** Pupzy's saved-search alert feature was designed but never finished: the `saved_searches` table, Drizzle export, `SYSTEM_ANNOUNCEMENT` notification type, an AdminJS `User Activity` resource and a `SavedSearch` GraphQL type were shipped as scaffolding, while no resolver, service, post-creation hook or admin action ever read or wrote the feature. The parent specification's only authorized schema-removal exception is "Saved-search removal": the unfinished feature must stop being advertised in the schema and admin, but the storage drop must be ordered against running services, so a destructive migration cannot ship in the same slice as the runtime retirement.

---

## Decision

### 1. Runtime surfaces are retired now (ticket 18)

- The orphan `SavedSearch` GraphQL type is removed from `src/posts/posts.graphql` and from the committed generated definitions in `src/graphql.ts`. No Query or Mutation field referenced it, so no existing client operation changes; this removal is the explicitly authorized GraphQL compatibility exception (spec Implementation Decisions 2 and 22).
- The AdminJS saved-search resource (`buildSavedSearchesResource`), its registration, and the `saved_searches` entry in `ADMIN_RESOURCE_TABLES` are removed. The admin service no longer introspects or links the table.
- Stale scaffolding comments that still advertised the feature (`adoption-posts.schema.ts`, `notifications.schema.ts`) are corrected. The `SYSTEM_ANNOUNCEMENT` notification type itself is retained: historical rows exist and clients may still receive them from the inbox; the type is documented as retired with no creation site.
- The unrelated saved-post surface (`mySavedPosts`, `toggleSave`, `isSavedByMe`, `post_saves`, `POST_SAVED` notifications) is untouched.

### 2. Storage stays temporarily compatible

- No migration is added and no historical migration is edited. `saved_searches` remains as created in `0000_familiar_shiver_man.sql` and evolved in `0003_nosy_korg.sql`.
- The Drizzle `savedSearches` export stays so the existing Account Deletion cleanup can continue deleting retained rows (`src/users/account-deletion.service.ts`). Test TRUNCATE lists keep `saved_searches` for the same overlap period.
- These are the only remaining runtime references, and they exist solely to keep deletion working while old code drains. Ticket 19 owns their removal together with the storage contraction.

### 3. Contraction prerequisite and rollout ordering (ticket 19)

The destructive migration must not run while any deployed code still queries the table. Required order:

1. Merge and deploy the retired runtime (this slice) to the API and admin services.
2. Confirm the rolling deployment has fully drained: no instance of the previous API or admin revision is still serving (old admin builds register the resource; old API builds expose the type, though neither writes rows).
3. In ticket 19, remove the transitional Account Deletion cleanup, the Drizzle schema/export, and the remaining test/truncate references.
4. Only then add and apply the forward migration that drops `saved_searches`; re-run clean-install and upgrade migration checks plus Account Deletion after contraction.

If step 4 runs before step 2 completes, an old instance performing Account Deletion (or admin introspection) would query a dropped table and fail.

### 4. Verification

- `node scripts/graphql-schema-compat.mjs d46e024 HEAD` from `backend/` must report exactly one incompatible entry — `REMOVED_TYPE SavedSearch` — with every other change additive or absent. That single entry is the authorized exception; any additional incompatibility is a defect.
- The backend retirement spec (`src/posts/saved-search-retirement.spec.ts`) locks the SDL, generated definitions and resolver/service/repository removal while proving the saved-post surface and the transitional Account Deletion cleanup survive.
- The storage-transition spec (`src/database/saved-search-storage-transition.spec.ts`) proves the historical migrations are untouched and no migration contracts the table during this slice.
- Account Deletion integration coverage seeds a retained saved-search row and proves cleanup still removes it while a surviving account's row is preserved.

---

## Alternatives Considered

- **Drop the table in the same slice:** rejected. Backend and admin deploy independently on Railway; a running old revision reconciled against a dropped table would fail mid-request, and the specification requires coordinated destructive cleanup.
- **Leave the admin resource in place until storage removal:** rejected. It would continue advertising the unfinished feature to staff, contradicting the removal goal.
- **Remove the `SYSTEM_ANNOUNCEMENT` enum value now:** rejected. It is storage/API surface, not a saved-search runtime caller; removing an enum value clients may have persisted breaks compatibility and belongs with the ticket 19 storage contraction, outside this slice's authorized exception.
- **Delete Account Deletion cleanup with the runtime:** rejected. Retained rows would survive account deletion during the overlap, breaking the established privacy guarantee.

## Consequences

- **Positive:** The schema and admin stop advertising an unfinished feature; the authorized removal is isolated and documented; Account Deletion keeps its cleanup guarantee; historical migrations remain auditable; deployment safety is explicit rather than implied.
- **Trade-offs & Mitigations:** The retired code leaves a small transitional footprint (schema export, one cleanup statement, truncate entries). Each is marked and owned by ticket 19, and a unit test fails if the table is contracted early or the historical migrations are edited.

## References

- Spec: `.scratch/backend-workflow-gaps/spec.md` — Implementation Decision 22 "Saved-search removal", Decision 2 "Compatibility", Testing Decision 13 "Migration and release checks".
- Tickets: `.scratch/backend-workflow-gaps/issues/18-retire-saved-search-runtime.md`, `19-remove-saved-search-storage.md`.
- Runtime contract: `docs/device-push-delivery-flutter-integration-contract.md` (retired `SYSTEM_ANNOUNCEMENT` stays inbox-only).
