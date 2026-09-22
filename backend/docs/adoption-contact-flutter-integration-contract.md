# Flutter Integration Contract: Approved Adoption Contact

This document is the authoritative client-facing contract for the additive `getAdoptionWhatsAppLink` query delivered by the approved adoption contact work. It covers the operation signature, authorization rules, neutral outcomes, error codes, and recommended client behavior.

> **Compatibility:** every existing GraphQL operation keeps its name, arguments, input shape, output shape, enum values, and nullability. This work is additive only. **Implementing the Flutter UI is a separate effort; this backend effort does not modify Flutter source or add Flutter tests.**

> **No phone verification:** the MVP keeps self-entered phone numbers. This query does not verify, certify, or claim ownership of the phone number, and it does not add any SMS/OTP step.

---

## 1. Overview

An approved adoption applicant needs the Post owner's WhatsApp link to act on the approval. `approveAdoptionApplication` returns the `AdoptionApplication` fields only — the `AdoptionApplication` type has no `whatsappLink` field, so the applicant previously had no way to obtain the link. `getAdoptionWhatsAppLink` is the additive, applicant-only retrieval query.

- **One purpose:** return the current WhatsApp link (`https://wa.me/<digits>`) for an already-approved adoption application.
- **Applicant-only:** only the account that submitted the application can call it.
- **Consent gate preserved:** the owner must have approved the application first; approval alone does not expose the phone through any generic `User` field.
- **Current value:** the link is built at query time from the owner's currently stored, decrypted phone number. It is never stored and reflects later owner profile updates.
- **Block-safe:** an active Block in either direction is treated as an unknown application, exactly like other contact disclosure paths.

---

## 2. Operation

| Operation | Kind | Authentication | Signature |
|---|---|---|---|
| `getAdoptionWhatsAppLink` | Query | Required | `getAdoptionWhatsAppLink(applicationId: ID!): String!` |

It is an additive field on the existing `Query` root. No existing operation, argument, result field, enum value, or nullability changed.

### 2.1 Example

```graphql
query GetAdoptionWhatsApp($applicationId: ID!) {
  getAdoptionWhatsAppLink(applicationId: $applicationId)
}
```

**Variables:**

```json
{
  "applicationId": "01916327-0000-7000-8000-000000000050"
}
```

**Response:**

```json
{
  "data": {
    "getAdoptionWhatsAppLink": "https://wa.me/201012345678"
  }
}
```

`applicationId` is the `AdoptionApplication.id` the applicant already receives from `submitAdoptionApplication` or `myAdoptionApplications`.

---

## 3. What the backend enforces

1. **Authentication required.** The global Firebase guard rejects missing/invalid sessions; suspended or deleting accounts cannot call the query.
2. **The application must exist.** A malformed `applicationId` returns `VALIDATION_ERROR`; an unknown but well-formed `applicationId` returns `NOT_FOUND`.
3. **The caller must be the original applicant.** The owner and any unrelated account receive `FORBIDDEN`. This is BOLA protection, not a Block signal.
4. **The application must be `APPROVED`.** `PENDING` and `REJECTED` applications return `VALIDATION_ERROR`. A `REJECTED` application cannot be revived.
5. **The Post must be accessible and not `REMOVED`.** A missing or administratively removed Post returns the ordinary neutral `NOT_FOUND` for the Post.
6. **The owner account must be active and have a phone number.** A banned, deleting, missing, or phone-less owner returns `NOT_FOUND` with the established "owner contact information is not available" behavior.
7. **Isolation is rechecked transactionally.** The account-pair advisory lock and Block recheck run inside the same transaction that reads the owner phone, so a Block committing first makes the application resolve as unknown and no phone is ever disclosed. A Block does not revoke an approval: after Unblock, a preserved `APPROVED` application can retrieve the link again.
8. **Closed listings do not revoke approved contact.** The link remains retrievable after the listing reaches a completed outcome (for example `ADOPTED`). Only an administrative removal hides the Post and the disclosure.

The owner's phone number is never exposed as a field on `AdoptionApplication`, `User`, or any other public type through this feature.

---

## 4. Errors and neutral outcomes

Error codes are delivered in GraphQL `extensions.code`.

| `extensions.code` | When | Client behavior |
|---|---|---|
| `UNAUTHENTICATED` | No valid session | Re-authenticate |
| `VALIDATION_ERROR` | Invalid `applicationId`, or the application is `PENDING`/`REJECTED` | Do not show contact; show the approval state |
| `FORBIDDEN` | The caller is not the application's applicant | Hide the contact action; indicates a UI bug |
| `NOT_FOUND` | Unknown application, removed/missing Post, isolated pair, or unavailable owner contact (banned, deleting, or no phone) | Show the existing neutral "This content isn't available" state |

There is deliberately **no** error code that reveals a Block. An isolated pair receives the same `NOT_FOUND` response as an unknown application id, with no phone number or link in the message.

---

## 5. Recommended client behavior

1. Offer the contact action only for the applicant's own `APPROVED` applications. Retrieve the link with this query when the app needs it (for example after approval, reopening the screen, or restoring state); the approval response itself does not carry the link.
2. Call the query on demand rather than storing the link long-term; the owner's current phone may change.
3. On success, open the returned `https://wa.me/...` link directly.
4. On `NOT_FOUND`, render the app's neutral unavailable state. Never say "You were blocked" or infer Block direction.
5. On network failure, retrying the query is safe: it is read-only and has no side effects.
6. Never derive, display, or cache the raw phone number from the link.

---

## 6. Compatibility statement

- `getAdoptionWhatsAppLink` is the only schema addition in this slice. Existing adoption, contact, feed, discussion, notification, engagement, and safety operations are unchanged.
- `approveAdoptionApplication`, `rejectAdoptionApplication`, `submitAdoptionApplication`, `myAdoptionApplications`, and `postAdoptionApplications` keep their existing names, arguments, results, and error behavior.
- Approval remains compatible: an application approved before this feature ships can retrieve the link immediately, subject to the same account, Post-visibility, and Block restrictions.
- Blocks continue to reuse existing unavailable/not-found behavior rather than introducing new error shapes; see `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md`.
- Reproduce the behavior with `src/adoptions/adoption-contact-access.integration.spec.ts`, which exercises the real GraphQL schema against Postgres, including both Block directions, account deletion/ban, missing phone, removed Post, and concurrent Block/approval races.
