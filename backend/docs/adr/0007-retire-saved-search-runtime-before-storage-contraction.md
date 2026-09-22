# 0007: Retire Saved-Search Runtime Before Storage Contraction

- **Status:** Accepted — runtime retirement (ticket 18) and storage contraction (ticket 19) both landed
- **Date:** 2026-09-21
- **Context:** Pupzy's saved-search alert feature was designed but never finished: the `saved_searches` table, Drizzle export, `SYSTEM_ANNOUNCEMENT` notification type, an AdminJS `User Activity` resource and a `SavedSearch` GraphQL type were shipped as scaffolding, while no resolver, service, post-creation hook or admin action ever read or wrote the feature. The parent specification's only authorized schema-removal exception is "Saved-search removal": the unfinished feature must stop being advertised in the schema and admin, and the destructive storage drop must be explicitly ordered against the running services rather than shipped as an ordinary rolling migration.

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

The destructive migration must not run while any deployed code still queries the table. Runtime retirement (ticket 18) and storage contraction (ticket 19) ship in the same release revision, and the ticket-18 runtime still deleted retained rows during Account Deletion; therefore a rolling deploy of this artifact is unsafe — the new revision's pre-deploy would apply `0053` while a pre-19 API revision (whose Account Deletion cleanup queries `saved_searches`) or a pre-18 AdminJS revision (which registers the resource) can still be serving.

The executable sequence for this artifact is stop-the-world:

1. Stop/scale the Main API and AdminJS services to zero so no running revision can query `saved_searches`.
2. Apply `0053_drop_saved_searches` from the sole migration owner with no containers serving: the new Main API revision's pre-deploy (`node dist/database/migrate.js`) or a one-off `node dist/database/migrate.js`. AdminJS never runs migrations.
3. Start/deploy the Main API and AdminJS revisions from this release and wait for health checks.
4. Re-run clean-install and upgrade migration checks plus Account Deletion against the contracted schema.

A zero-downtime rollout requires an intermediate release that contains ticket 19's runtime changes (Account Deletion cleanup, Drizzle schema/export, test/truncate references) **without** migration `0053`, fully drained before the drop; this release does not provide that intermediate artifact. If the drop runs before the pre-19 runtime has stopped, an old instance performing Account Deletion (or old admin introspection) would query a dropped table and fail. The migration is written and verified locally in this slice; no hosted/production migration is executed by ticket publication.

### 4. Verification (ticket 18)

- `node scripts/graphql-schema-compat.mjs d46e024 HEAD` from `backend/` was run on commit `b4dfb93` and reported exactly one incompatible entry — `REMOVED_TYPE SavedSearch` — with zero additive changes. That single entry is the authorized exception; any additional incompatibility is a defect.
- The backend retirement spec (`src/posts/saved-search-retirement.spec.ts`) locks the SDL, generated definitions and resolver/service/repository removal while proving the saved-post surface survives. After ticket 19 it also fails if any transitional saved-search reference returns to a resolver, service or repository.
- Account Deletion integration coverage proved cleanup still removed retained rows during the overlap.

### 5. Storage contraction delivered (ticket 19)

- Forward migration `0053_drop_saved_searches` drops `saved_searches` and is the only migration that contracts it. Migrations `0000` and `0003` remain byte-for-byte intact, so clean installs replay the same create/evolve history before dropping.
- Removed with the contraction: `src/database/schema/saved-searches.schema.ts` and its schema-barrel export, the transitional `savedSearches` delete in `src/users/account-deletion.service.ts`, the `saved_searches` entries in the backend and admin test TRUNCATE/cleanup lists, and the saved-search rows in the city reconcile/release integration fixtures. Admin registration was already removed in ticket 18 and its absence assertions remain.
- `SYSTEM_ANNOUNCEMENT` is intentionally retained: the enum value, bilingual templates and historical inbox rows are notification history, not saved-search storage. Removing the enum value would break existing rows and persisted client state, so it stays with no creation site.
- Rollout ordering is unchanged and operationally binding: this revision ships the runtime retirement and `0053` together, so either stop both the Main API and AdminJS services and apply the migration with no revision serving, or cut a runtime-only intermediate release and drain it before the drop. AdminJS never runs migrations. The stop-the-world sequence and the zero-downtime alternative are recorded in `docs/integrated-mvp-frontend-handoff.md` §6 and `docs/deployment/three-service-railway-release.md` §4.

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
