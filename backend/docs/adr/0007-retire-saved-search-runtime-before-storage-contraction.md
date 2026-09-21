# 0007: Retire Saved-Search Runtime Before Storage Contraction

- **Status:** Accepted — runtime retirement (ticket 18) and storage contraction (ticket 19) both landed
- **Date:** 2026-09-21
- **Context:** Pupzy's saved-search alert feature was designed but never finished: the `saved_searches` table, Drizzle export, `SYSTEM_ANNOUNCEMENT` notification type, an AdminJS `User Activity` resource and a `SavedSearch` GraphQL type were shipped as scaffolding, while no resolver, service, post-creation hook or admin action ever read or wrote the feature. The parent specification's only authorized schema-removal exception is "Saved-search removal": the unfinished feature must stop being advertised in the schema and admin, but the storage drop must be ordered against running services, so a destructive migration cannot ship in the same slice as the runtime retirement.

---

## Decision

### 1. Runtime surfaces are retired now (ticket 18)

- The orphan `SavedSearch` GraphQL type is removed from `src/posts/posts.graphql` and from the committed generated definitions in `src/graphql.ts`. No Query or Mutation field referenced it, so no existing client operation changes; this removal is the explicitly authorized GraphQL compatibility exception (spec Implementation Decisions 2 and 22).
- The AdminJS saved-search resource (`buildSavedSearchesResource`), its registration, and the `saved_searches` entry in `ADMIN_RESOURCE_TABLES` are removed. The admin service no longer introspects or links the table.
- Stale scaffolding comments that still advertised the feature (`adoption-posts.schema.ts`, `notifications.schema.ts`) are corrected. The `SYSTEM_ANNOUNCEMENT` notification type itself is retained: historical rows exist and clients may still receive them from the inbox; the type is documented as retired with no creation site.
- The unrelated saved-post surface (`mySavedPosts`, `toggleSave`, `isSavedByMe`, `post_saves`, `POST_SAVED` notifications) is untouched.

### 2. Storage stayed temporarily compatible (ticket 18, superseded by ticket 19)

- No migration was added and no historical migration was edited in ticket 18. `saved_searches` remained as created in `0000_familiar_shiver_man.sql` and evolved in `0003_nosy_korg.sql`.
- The Drizzle `savedSearches` export stayed so the existing Account Deletion cleanup could continue deleting retained rows (`src/users/account-deletion.service.ts`). Test TRUNCATE lists kept `saved_searches` for the same overlap period.
- These were the only remaining runtime references, and they existed solely to keep deletion working while old code drained. Ticket 19 removed all of them together with the storage contraction.

### 3. Contraction prerequisite and rollout ordering (ticket 19)

The destructive migration must not run while any deployed code still queries the table. Required order:

1. Merge and deploy the retired runtime (ticket 18) to the API and admin services.
2. Confirm the rolling deployment has fully drained: no instance of the previous API or admin revision is still serving (old admin builds register the resource; old API builds expose the type, though neither writes rows).
3. Remove the transitional Account Deletion cleanup, the Drizzle schema/export, and the remaining test/truncate references (ticket 19).
4. Only then apply the forward migration `0053_drop_saved_searches`; re-run clean-install and upgrade migration checks plus Account Deletion after contraction.

If step 4 runs before step 2 completes, an old instance performing Account Deletion (or admin introspection) would query a dropped table and fail. The migration is written and verified locally in this slice; no hosted/production migration is executed by ticket publication.

### 4. Verification (ticket 18)

- `node scripts/graphql-schema-compat.mjs d46e024 HEAD` from `backend/` was run on commit `b4dfb93` and reported exactly one incompatible entry — `REMOVED_TYPE SavedSearch` — with zero additive changes. That single entry is the authorized exception; any additional incompatibility is a defect.
- The backend retirement spec (`src/posts/saved-search-retirement.spec.ts`) locks the SDL, generated definitions and resolver/service/repository removal while proving the saved-post surface survives. After ticket 19 it also fails if any transitional saved-search reference returns to a resolver, service or repository.
- Account Deletion integration coverage proved cleanup still removed retained rows during the overlap.

### 5. Storage contraction delivered (ticket 19)

- Forward migration `0053_drop_saved_searches` drops `saved_searches` and is the only migration that contracts it. Migrations `0000` and `0003` remain byte-for-byte intact, so clean installs replay the same create/evolve history before dropping.
- Removed with the contraction: `src/database/schema/saved-searches.schema.ts` and its schema-barrel export, the transitional `savedSearches` delete in `src/users/account-deletion.service.ts`, the `saved_searches` entries in the backend and admin test TRUNCATE/cleanup lists, and the saved-search rows in the city reconcile/release integration fixtures. Admin registration was already removed in ticket 18 and its absence assertions remain.
- `SYSTEM_ANNOUNCEMENT` is intentionally retained: the enum value, bilingual templates and historical inbox rows are notification history, not saved-search storage. Removing the enum value would break existing rows and persisted client state, so it stays with no creation site.
- Rollout ordering is unchanged and operationally binding: deploy the retired runtime, confirm the rolling deployment has drained, then let the Main API's sole pre-deploy migration owner apply `0053`. AdminJS never runs migrations. The expand/contract phase is recorded in `docs/deployment/three-service-railway-release.md` §4.

### 6. Contraction verification

- `src/database/saved-search-storage-contraction.spec.ts` proves historical migrations are preserved, exactly one migration drops the table, the contraction is the last journal entry, the schema module/export are gone, and no backend runtime/test helper or admin runtime/test fixture references the storage.
- `src/database/migrate.integration.spec.ts` proves both paths against real Postgres: a clean install never leaves `saved_searches`, and an upgrade from a populated pre-contraction schema (0000..0052) drops the table while preserving the account, unrelated tables (`post_saves`), `SYSTEM_ANNOUNCEMENT` enum and a retained notification row.
- Account Deletion and API/admin startup integration suites run against the fully contracted schema with no transitional cleanup, proving the runtime survives the drop.

---

## Alternatives Considered

- **Drop the table in the same slice:** rejected. Backend and admin deploy independently on Railway; a running old revision reconciled against a dropped table would fail mid-request, and the specification requires coordinated destructive cleanup.
- **Leave the admin resource in place until storage removal:** rejected. It would continue advertising the unfinished feature to staff, contradicting the removal goal.
- **Remove the `SYSTEM_ANNOUNCEMENT` enum value now:** rejected. It is storage/API surface, not a saved-search runtime caller; historical notification rows and persisted client state may still use the value, so removing it breaks compatibility. Ticket 19 revisited this during contraction and kept the enum value, its templates and historical rows as inbox history.
- **Delete Account Deletion cleanup with the runtime:** rejected. Retained rows would survive account deletion during the overlap, breaking the established privacy guarantee.

## Consequences

- **Positive:** The schema and admin stop advertising an unfinished feature; the authorized removal is isolated and documented; Account Deletion keeps its cleanup guarantee; historical migrations remain auditable; deployment safety is explicit rather than implied; the retired storage no longer lingers after the deployment overlap.
- **Trade-offs & Mitigations:** Ticket 18's transitional footprint (schema export, one cleanup statement, truncate entries) was removed by ticket 19's contraction. The retained `SYSTEM_ANNOUNCEMENT` enum value is a documented compatibility exception with no creation site. Contraction tests fail if historical migrations are edited, if any migration other than `0053_drop_saved_searches` drops the table, or if a storage reference returns to runtime code or test fixtures.

## References

- Spec: `.scratch/backend-workflow-gaps/spec.md` — Implementation Decision 22 "Saved-search removal", Decision 2 "Compatibility", Testing Decision 13 "Migration and release checks".
- Tickets: `.scratch/backend-workflow-gaps/issues/18-retire-saved-search-runtime.md`, `19-remove-saved-search-storage.md`.
- Runtime contract: `docs/device-push-delivery-flutter-integration-contract.md` (retired `SYSTEM_ANNOUNCEMENT` stays inbox-only).
- Contraction guards: `src/database/saved-search-storage-contraction.spec.ts`, `src/database/migrate.integration.spec.ts`.
- Deployment ordering: `docs/deployment/three-service-railway-release.md` §4 (Expand / Contract).
