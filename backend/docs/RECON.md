# Phase 0 — Reconnaissance Report

| Item | Topic | Result / Value | Drift Status |
|------|-------|----------------|--------------|
| **R1** | GraphQL SDL Files & `PostType` Enum | `src/posts/posts-enums.graphql` and `src/common/graphql/enums.graphql` both define `enum PostType`. Multi-file schema with `extend type Query` / `extend type Mutation`. | Matched Expected |
| **R2** | `posts` DB Insert Pattern | `src/posts/posts.repository.ts`: Pre-generated `id` (UUIDv7), `creatorId`, `postType`, `title`, `description`, `status`, `moderationStatus`, `urgency` (null for adoption/product), `cityId`, `governorate`, `areaName`, `coordinates` (NOT NULL PostGIS point geometry), `effectiveScore`. | Matched Expected |
| **R3** | Media Attachment Pattern | `src/posts/posts.service.ts`: Two-phase upload flow. `prepareMedia` calculates R2 URLs before DB transaction; DB inserts `post_media` rows in transaction; `runFinalizeMediaAsync` executes `uploadService.finalizeMedia` (scoped to `staging/${userId}/${mediaId}`) after transaction commits. | Matched Expected |
| **R4** | Exception Filter | `src/common/filters/gql-exception.filter.ts` registered as `APP_FILTER` in `app.module.ts`. Maps `AppError` (`NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`) `.code` to GraphQL `extensions.code`. | Matched Expected |
| **R5** | Idempotency Interceptor | `src/common/interceptors/idempotency.interceptor.ts` registered as global `APP_INTERCEPTOR` in `app.module.ts`. Covers all mutations with `X-Idempotency-Key`. | Matched Expected |
| **R6** | Adoption Applications Files | `src/adoptions/adoptions.service.ts`, `src/adoptions/adoptions.repository.ts`, `src/adoptions/adoptions.resolver.ts`, `src/adoptions/adoptions.module.ts`, `src/adoptions/dto/submit-adoption-application.input.ts`, `src/database/schema/adoption-applications.schema.ts`. | Matched Expected |
| **R7** | Notifications Service Safety | `src/notifications/notifications.service.ts`: `fireNotification` catches repository errors with `.catch(...)` and logs them without rethrowing. `FIRE_IS_SAFE = true`. | Matched Expected |
| **R8** | Pagination Clamp Sites | `src/contacts/contacts.service.ts` (lines 236, 272), `src/adoptions/adoptions.service.ts` (lines 180, 214), `src/notifications/notifications.service.ts` (line 46). | Matched Expected |
| **R9** | Drizzle pgEnum Symbols | `src/database/schema/enums.ts`: `postTypeEnum` ('post_type'), `postStatusEnum` ('post_status'), `speciesTypeEnum` ('species_type': DOG, CAT, BIRD, RABBIT, OTHER), `genderTypeEnum` ('gender_type': MALE, FEMALE, UNKNOWN), `ageUnitEnum` ('age_unit': DAYS, WEEKS, MONTHS, YEARS), `requestStatusEnum` ('request_status': PENDING, APPROVED, REJECTED). | Matched Expected |
| **R10** | Migrations & Drizzle-Kit | `drizzle/migrations` with `meta/_journal.json` (format: `version`, `when`, `tag`, `breakpoints` per entry; snapshot files per migration). Drizzle-kit version: `^0.31.10`. Migration script: `db:migrate` (`drizzle-kit migrate`). | Matched Expected |
| **R11** | GraphQL Perimeter Settings | `src/app.module.ts`: `playground` & `introspection` gated on `NODE_ENV !== 'production'`. `validationRules: [depthLimit(10)]` configured. | Matched Expected |
| **R12** | `post_type` CHECK Constraints | `drizzle/custom.sql`: `posts_urgency_matches_post_type_constraint` enumerates `RESCUE, LOST` (urgency NOT NULL) and `ADOPTION, PRODUCT` (urgency IS NULL). No other constraints enumerate `post_type`. | Matched Expected |

---

### Business Decision Note: Multiple Approved Adoption Applications
In the MVP, multiple APPROVED adoption applications per post are allowed (the owner may shortlist multiple applicants; approving an application does not automatically transition the post to `ADOPTED`).

---

### Rollback SQL (for MAT changes)
```sql
DROP INDEX IF EXISTS "idx_posts_mating_active_created";
DROP INDEX IF EXISTS "idx_mating_posts_species_gender";
DROP TABLE IF EXISTS "mating_posts";
-- ('MATING' enum value cannot be removed in PG; leaving it is harmless.)
```
