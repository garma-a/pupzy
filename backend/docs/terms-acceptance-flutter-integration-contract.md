# Flutter Integration Contract: Versioned Terms Acceptance

This document specifies the authoritative client-facing contract for versioned Terms Acceptance in Pupzy. It covers the published version/URL surface, the idempotent acceptance operation, the exact protected operations, the stable error contract and the client changes required to integrate it.

---

## 1. Overview & Release Dependency

- The backend records **one current acceptance per Pupzy Account**: the accepted version and the time it was accepted. The backend never fabricates consent and never backfills legacy rows.
- Acceptance is **versioned**: accepting version `X` only satisfies the gate while `X` is the published version. When the published version changes, every earlier acceptance becomes insufficient and protected operations require the new version.
- The gate is **configuration-driven**: it only activates once the release owner supplies the real published Terms URL and version. The backend does not invent a live URL or version, and this ticket is not blocked on the Flutter-authored document.
- **Release dependency (not a backend blocker):** the actual published Terms document URL/version and the client's acceptance UI must be ready before enforcement is enabled in production. Until then, leave `TERMS_URL`/`TERMS_VERSION` unset in the environment.
- Browsing, account controls, safety/reporting/Block actions and Account Deletion remain usable without current acceptance.

---

## 2. Configuration (Backend/Release Owner)

Both variables live in the Main API environment (`backend/src/config/env.config.ts`):

| Variable | Required | Purpose |
|---|---|---|
| `TERMS_URL` | Paired | Public URL where the current Terms can be read (e.g. `https://pupzy.net/<published-path>`). |
| `TERMS_VERSION` | Paired | Version identifier of the currently published Terms (1–64 characters). |

Rules:

- Set **both or neither**. Setting only one fails environment validation at startup.
- While both are unset, `terms.currentVersion`/`terms.termsUrl` are `null`, `acceptanceRequired` is `false`, and no publication/submission operation is gated.
- Set both only after the published document exists and clients support acceptance. No code change or deployment of new migrations is needed to flip the gate; only the environment change.
- Changing `TERMS_VERSION` immediately makes all earlier acceptances insufficient.

---

## 3. GraphQL Contract

### 3.1 Types

```graphql
type TermsInfo {
  currentVersion: String      # published version, null when not configured
  termsUrl: String            # public document URL, null when not configured
  acceptedVersion: String     # version this account accepted, null if never
  acceptedAt: DateTime        # when acceptedVersion was recorded, null if never
  acceptanceRequired: Boolean! # true when this account must accept currentVersion
}

input AcceptTermsInput {
  version: String!            # the version the client displayed; must be current
}
```

`DateTime` is the existing ISO-8601 UTC scalar.

### 3.2 Query `terms` (authenticated)

Returns the published version/URL plus this account's acceptance state. This query is never gated, so a client can always discover what to accept.

```graphql
query Terms {
  terms {
    currentVersion
    termsUrl
    acceptedVersion
    acceptedAt
    acceptanceRequired
  }
}
```

Example response while version `2026-09-01` is published and the account has not accepted:

```json
{
  "data": {
    "terms": {
      "currentVersion": "2026-09-01",
      "termsUrl": "https://pupzy.net/terms",
      "acceptedVersion": null,
      "acceptedAt": null,
      "acceptanceRequired": true
    }
  }
}
```

### 3.3 Mutation `acceptTerms` (authenticated)

Records acceptance of the currently published version.

```graphql
mutation AcceptTerms($input: AcceptTermsInput!) {
  acceptTerms(input: $input) {
    currentVersion
    termsUrl
    acceptedVersion
    acceptedAt
    acceptanceRequired
  }
}
```

Variables:

```json
{ "input": { "version": "2026-09-01" } }
```

Semantics:

- **Idempotent:** repeating acceptance of the same version is a no-op that returns the originally recorded `acceptedAt`.
- **Versioned:** accepting a new published version replaces `acceptedVersion`/`acceptedAt` with the new version and the new time.
- **Unknown/stale versions are rejected** (`TERMS_VERSION_MISMATCH`); the response error extensions carry the version the client should accept instead.
- Accepting while no Terms are configured fails with `VALIDATION_ERROR`.
- The response is the same `TermsInfo` shape as the `terms` query, so the client can update its state from the mutation result alone.

---

## 4. Protected Operations

The following operations require current acceptance. They are enforced at the transport level (a global guard runs after authentication and before the resolver), so no client input can bypass or satisfy the gate other than `acceptTerms`.

| Operation | Kind | What is gated |
|---|---|---|
| `createRescuePost` | Mutation | Publishing a RESCUE Post |
| `createLostPost` | Mutation | Publishing a LOST Post (LOST_PET / FOUND_STRAY) |
| `createAdoptionPost` | Mutation | Publishing an ADOPTION Post |
| `createProductPost` | Mutation | Publishing a PRODUCT Post |
| `createMatingPost` | Mutation | Publishing a MATING Post |
| `createComment` | Mutation | Publishing a top-level Comment (including image Comments) |
| `createReply` | Mutation | Publishing a Reply |
| `requestContact` | Mutation | Submitting a Contact Request |
| `submitAdoptionApplication` | Mutation | Submitting an Adoption Application |

### 4.1 Operations intentionally available without current acceptance

- **Browsing:** `me`, all feeds and detail queries, `comments`, `replies`, `myPosts`, `mySavedPosts`, `notifications`, `terms`.
- **Account controls:** `completeProfile` (onboarding), `updateProfile`, `updateMyLocation`, `updateMyLanguagePreference`, `updateMyNotificationPreferences`, `registerDevice`, `unregisterDevice`, `deleteMyAccount`.
- **Safety/reporting/Block:** `reportPost`, `reportComment`, `reportUser`, `blockUser`, `unblockUser`.
- **Engagement and existing interactions:** `toggleUpvote`, `toggleSave`, `recordView`, `toggleCommentBoost`, `pinComment`, `unpinComment`, `approveContactRequest`, `rejectContactRequest`, `approveAdoptionApplication`, `rejectAdoptionApplication`, `getWhatsAppLink`, `getProductSellerContact`, `getAdoptionWhatsAppLink`, `renewPost`, `updatePostStatus`, `deletePost`, `deleteComment`, `requestCommentImageUploadUrl`, `requestMediaUploadUrl`.

Onboarding input is unchanged: `CompleteProfileInput` gained **no** required terms field, and completing a profile never requires acceptance.

---

## 5. Error Contract

All errors arrive as standard GraphQL `errors[]` entries. The stable codes are:

| Code | Operation | Meaning | `extensions` |
|---|---|---|---|
| `TERMS_ACCEPTANCE_REQUIRED` | Any protected operation | The account has no acceptance of the published version (or accepted an older one). | `currentVersion`, `termsUrl` |
| `TERMS_VERSION_MISMATCH` | `acceptTerms` | The submitted version is not the published version. | `currentVersion`, `termsUrl` |
| `VALIDATION_ERROR` | `acceptTerms` | Malformed/empty version, or no Terms configured for this deployment. | — |

Example protected-operation failure:

```json
{
  "errors": [
    {
      "message": "You must accept the current Terms before publishing or submitting.",
      "extensions": {
        "code": "TERMS_ACCEPTANCE_REQUIRED",
        "currentVersion": "2026-09-01",
        "termsUrl": "https://pupzy.net/terms"
      }
    }
  ],
  "data": null
}
```

Clients must treat `TERMS_ACCEPTANCE_REQUIRED` on a protected operation as a prompt to show the current Terms (using `extensions.termsUrl`) and call `acceptTerms` with `extensions.currentVersion`, not as a generic failure.

---

## 6. Exact Client Changes

1. **Onboarding is untouched.** Keep sending the existing `CompleteProfileInput`. Do not add a terms field and do not block profile completion on acceptance.
2. **On authenticated launch / resume**, call the `terms` query. If `currentVersion` is non-null:
   - when `acceptanceRequired` is `true`, show the acceptance UI with `termsUrl` and a link/button to accept `currentVersion`;
   - when `acceptanceRequired` is `false`, continue normally.
   - While `currentVersion` is `null`, no Terms are published; show no acceptance UI.
3. **Acceptance call:** send `acceptTerms(input: { version: currentVersion })`. Update local state from the mutation response. Repeat taps are safe: the backend preserves the original `acceptedAt` and never duplicates consent.
4. **Before any protected operation** (the table in §4), ensure the latest known `acceptanceRequired` is `false`. If a protected call fails with `TERMS_ACCEPTANCE_REQUIRED`:
   - read `extensions.currentVersion` and `extensions.termsUrl`,
   - refresh the `terms` query (the published version may have changed since launch),
   - present acceptance, then retry the original operation once after successful acceptance.
5. **Handle version changes at runtime.** A long-lived session can receive `TERMS_ACCEPTANCE_REQUIRED` even after a prior acceptance; always re-read `currentVersion` from the error extensions rather than caching a hard-coded version.
6. **Do not gate** browsing, account controls, reporting/Blocking or Account Deletion on acceptance, and do not hide those surfaces behind the acceptance screen.
7. **Account Deletion** remains available without acceptance; the deletion removes the account's recorded acceptance along with the account.
8. **Do not** attempt to satisfy the gate through operation inputs; publication inputs have no terms field, and unknown fields are rejected by GraphQL validation.

---

## 7. Admin Inspection & Account Deletion

- The AdminJS **Users** resource shows `terms_accepted_version` and `terms_accepted_at` on the record page. Both fields are read-only (system-recorded consent); admin edit payloads cannot tamper with them.
- Account Deletion deletes the `users` row, which owns the acceptance, so the acceptance record is removed with the account. Deletion never requires current acceptance.

---

## 8. Rollout & Verification

1. Deploy the migration `0054_add_terms_acceptance` (adds nullable `users.terms_accepted_version` / `users.terms_accepted_at`; no backfill, no fabricated consent).
2. Deploy the API with `TERMS_URL`/`TERMS_VERSION` still unset. The `terms` query reports `null` values and no operation is gated.
3. When the Terms document is published and the client acceptance UI ships, set `TERMS_URL` and `TERMS_VERSION` in the Main API environment and restart/redeploy. Enforcement activates with no code change.
4. To publish a new version, update `TERMS_VERSION` (and `TERMS_URL` if the path changed). Earlier acceptances stop satisfying the gate immediately.
5. Backend verification: `backend/src/terms/terms-acceptance.integration.spec.ts` exercises authenticated HTTP acceptance, idempotency, version changes, invalid versions, gate bypass attempts, the full protected-operation list and the operations that remain available; `backend/src/users/account-deletion.integration.spec.ts` covers acceptance cleanup on deletion; the admin HTTP suite covers inspection.
