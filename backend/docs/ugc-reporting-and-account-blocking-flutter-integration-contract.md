# Flutter Integration Contract: UGC Reporting & Account Blocking

This document is the authoritative client-facing contract for integrating Pupzy's Report and Block safety features in the Flutter mobile application. It covers every additive GraphQL operation, input, enum, output, pagination shape, validation rule, error, and recommended interaction for the safety work delivered by the UGC Reporting and Account Blocking effort.

> **Compatibility:** every existing GraphQL operation keeps its name, arguments, input shape, output shape, enum values, and nullability. This effort is additive only. **Implementing the Flutter UI is a separate effort performed by the frontend developer; this backend effort does not modify Flutter source or add Flutter tests.**

> **Compliance positioning:** this effort closes identified in-app reporting and blocking gaps (a Post/Account reporting path and a reversible Block). It does **not** certify complete Apple App Review or Google Play User Generated Content compliance. Terms acceptance, published support contact, broader content-filtering review, moderation staffing, and response-time operations require separate verification.

---

## 1. Overview & Architectural Principles

- **Report and Block are distinct actions.** A Report asks Pupzy administrators to review a Post, Comment/Reply, or Pupzy Account. A Block immediately isolates two Pupzy Accounts from each other. Neither action silently performs the other; the app offers Block as an explicit, optional follow-up after a successful Report.
- **One shared report allowance.** Post Reports, Comment Reports, and Pupzy Account Reports all draw from one allowance of **10 successfully committed reports per Pupzy Account per rolling 24 hours**. Alternating report types cannot bypass the limit.
- **Blocks are directional but mutually isolating.** The account that created a Block owns it and only that account can remove it. While either direction of a Block is active, neither account can discover or directly retrieve the other's content, initiate interaction, disclose contact information, or generate notifications.
- **Privacy-preserving responses.** No public error or payload reveals that a Block exists or which account created it. No notification is ever sent for a Report, Block, or Unblock.
- **Additive operations only.** The new surface is `reportPost`, `reportUser`, `blockUser`, `unblockUser`, and `blockedUsers`. Everything else is unchanged.
- **No client-generated idempotency keys are required** for safety mutations: `blockUser` and `unblockUser` are naturally idempotent, and duplicate Reports are rejected without consuming the allowance (see §7).

---

## 2. New Operations at a Glance

| Operation | Kind | Authentication | Signature | Purpose |
|---|---|---|---|---|
| `reportPost` | Mutation | Required | `reportPost(input: ReportPostInput!): Boolean!` | Report an abusive Post of any listing type |
| `reportUser` | Mutation | Required | `reportUser(input: ReportUserInput!): Boolean!` | Report another Pupzy Account's conduct |
| `blockUser` | Mutation | Required | `blockUser(userId: ID!): Boolean!` | Create the caller-owned Block on another account |
| `unblockUser` | Mutation | Required | `unblockUser(userId: ID!): Boolean!` | Remove the Block the caller owns |
| `blockedUsers` | Query | Required | `blockedUsers(first: Int, after: String): BlockedUserConnection!` | Cursor-paginated list of accounts the caller blocked |
| `reportComment` | Mutation | Required | `reportComment(input: ReportCommentInput!): Boolean!` | **Existing operation, unchanged**; continues to report a Comment or Reply |

All five new operations are additive fields on the existing `Query`/`Mutation` roots. No existing operation name, argument, result field, enum value, or nullability changed (proved by `scripts/graphql-schema-compat.mjs`, see the release evidence document).

### 2.1 Review outcomes are not exposed to Flutter

Report review happens in the administrative moderation tools. The public GraphQL API exposes **no** query for report status, review outcome, or reviewer metadata, and no review-outcome enum. All three report mutations return `Boolean!`; the existing `PostReport` type is not reachable from any public operation. Flutter therefore shows a submission confirmation only — it never polls for a decision, and reporters are not notified of review outcomes.

---

## 3. Report a Post

### 3.1 Operation

```graphql
mutation ReportPost($input: ReportPostInput!) {
  reportPost(input: $input)
}
```

**Variables:**

```json
{
  "input": {
    "postId": "01916327-0000-7000-8000-000000000010",
    "reason": "SPAM",
    "details": "Repeated identical listing posted several times today"
  }
}
```

### 3.2 `ReportPostInput`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `postId` | `ID!` | Yes | UUID of the Post being reported. Any listing type (RESCUE, LOST, ADOPTION, PRODUCT, MATING) is reportable. |
| `reason` | `ReportReason!` | Yes | Structured reason from the shared content-report enum (§4). |
| `details` | `String` | No | Optional free text. Trimmed on write; blank is treated as absent; maximum 500 characters after trimming; **required and nonblank when `reason` is `OTHER`**. |

### 3.3 What the backend enforces

- **Authentication required.**
- **The Post must be accessible and not `REMOVED`.** Removed Posts, and Posts whose creator is isolated from the caller by a Block, resolve to the ordinary neutral `NOT_FOUND` behavior.
- **Self-reporting is rejected** with `FORBIDDEN` (`You cannot report your own post`).
- **One report per reporting account per Post, ever** (`POST_ALREADY_REPORTED`, a `CONFLICT`). This includes an earlier report that has since been reviewed.
- **An accepted report never removes the Post.** The first accepted open report on a `CLEAN` Post flags it for administrator review while leaving it `ACTIVE` and visible.
- **Comment Reports keep their existing automatic image/Comment hiding rules unchanged**; Post Reports have no automatic removal threshold.

### 3.4 Result semantics

The mutation returns `true` when the report is committed. Because the allowance only counts commits, a client may safely retry after an ambiguous network failure; a retry of an already-committed report is rejected as a duplicate **without consuming allowance**.

---

## 4. `ReportReason` (existing shared content enum)

Used by `reportPost` and the existing `reportComment`. Values and meanings are unchanged.

| Value | Meaning | Suggested UI label |
|---|---|---|
| `UNRELATED_TO_ANIMALS` | The content is not related to animals or pet care | Unrelated to animals |
| `SPAM` | Repetitive, promotional, or disruptive content | Spam |
| `INAPPROPRIATE_CONTENT` | Offensive, graphic, or otherwise inappropriate material | Inappropriate content |
| `SCAM` | Attempted fraud, misleading sale, or deceptive listing | Scam or fraud |
| `DUPLICATE` | The same listing or content already exists | Duplicate listing |
| `OTHER` | None of the above; requires nonblank `details` | Other |

Account-level reasons live in a **separate** enum (`AccountReportReason`, §7.3) so content-only reasons such as `DUPLICATE` are never offered when reporting an account.

---

## 5. Report a Comment or Reply (existing behavior, unchanged)

`reportComment` is unchanged and remains the correct entry point for a discussion contribution:

```graphql
mutation ReportComment($input: ReportCommentInput!) {
  reportComment(input: $input)
}
```

```json
{
  "input": {
    "commentId": "01916327-0000-7000-8000-000000000040",
    "reason": "INAPPROPRIATE_CONTENT",
    "details": "Optional context"
  }
}
```

Existing rules kept intact:

- Report a top-level Comment or a Reply through the same `commentId`.
- Self-reporting is rejected with `FORBIDDEN`.
- Duplicate reporter/comment pairs are rejected with `COMMENT_ALREADY_REPORTED`.
- `details` is optional and trimmed; the existing contract does **not** require details for `OTHER` (unlike `reportPost` and `reportUser`), and that behavior is intentionally preserved.
- The existing automatic moderation rules are unchanged: one qualifying `INAPPROPRIATE_CONTENT` report can hide a Comment's images (`IMAGE_HIDDEN`), and three qualifying reports can hide the whole Comment (`HIDDEN`) with counter updates.
- `reportComment` draws from the same shared allowance as `reportPost` and `reportUser`. On exhaustion it keeps its existing `RATE_LIMITED` message, `Daily comment report limit reached (10 per day)` (see §7).

---

## 6. Report a Pupzy Account (`reportUser`)

### 6.1 Operation

```graphql
mutation ReportUser($input: ReportUserInput!) {
  reportUser(input: $input)
}
```

**Variables (no source context):**

```json
{
  "input": {
    "userId": "01916327-0000-7000-8000-000000000020",
    "reason": "HARASSMENT",
    "details": "Sent repeated threatening messages after I declined the adoption application"
  }
}
```

**Variables (with source context):**

```json
{
  "input": {
    "userId": "01916327-0000-7000-8000-000000000020",
    "reason": "SCAM_OR_FRAUD",
    "details": "Asked for a deposit before showing the animal",
    "sourceType": "CONTACT_REQUEST",
    "sourceId": "01916327-0000-7000-8000-000000000060"
  }
}
```

### 6.2 `ReportUserInput`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `userId` | `ID!` | Yes | UUID of the reported Pupzy Account. |
| `reason` | `AccountReportReason!` | Yes | Account-specific reason (§6.3). |
| `details` | `String` | No | Trimmed, blank treated as absent, max 500 characters; **required and nonblank when `reason` is `OTHER`**. |
| `sourceType` | `AccountReportSourceType` | Optional | Evidence surface type (§6.4). `sourceType` and `sourceId` must be supplied together or both omitted. |
| `sourceId` | `ID` | Optional | UUID of the evidence record. It must exist, be accessible to the reporter, and involve the reported account. |

### 6.3 `AccountReportReason`

| Value | Meaning | Suggested UI label |
|---|---|---|
| `HARASSMENT` | Targeted harassment or bullying | Harassment or bullying |
| `SPAM` | Repeated unwanted promotional or disruptive contact | Spam |
| `SCAM_OR_FRAUD` | Fraud, deceptive requests, or financial abuse | Scam or fraud |
| `IMPERSONATION` | Pretending to be another person or organization | Impersonation |
| `INAPPROPRIATE_CONDUCT` | Offensive or abusive conduct | Inappropriate conduct |
| `SAFETY_CONCERN` | Conduct presenting a safety risk | Safety concern |
| `OTHER` | None of the above; requires nonblank `details` | Other |

This enum deliberately excludes content-only reasons (`DUPLICATE`, `UNRELATED_TO_ANIMALS`).

### 6.4 `AccountReportSourceType` and source-context rules

| Value | Evidence record | Who must the reported account be? |
|---|---|---|
| `POST` | A Post | Its creator. The Post must not be `REMOVED`. |
| `COMMENT` | A top-level Comment **or Reply** (same `commentId` space) | Its author. The Comment must be `ACTIVE` or `IMAGE_HIDDEN`; a Reply's parent branch must still be reachable. The hosting Post must not be `REMOVED`. |
| `CONTACT_REQUEST` | A Contact Request | Either party: the reporter may be the requester and the reported account the Post owner, or the reverse. |
| `ADOPTION_APPLICATION` | An Adoption Application | Either party: the reporter may be the applicant and the reported account the Post owner, or the reverse. |

Every invalid, missing, inaccessible, or non-involving source reference returns the **same** `VALIDATION_ERROR`:

> `Source context does not exist, is inaccessible, or does not involve the reported Pupzy Account`

The uniform message prevents probing whether an arbitrary private interaction id exists, and prevents attaching an unrelated private interaction to a complaint.

### 6.5 What the backend enforces

- **Authentication required.**
- **Self-reporting is rejected** with `FORBIDDEN` (`You cannot report your own Pupzy Account`).
- **The target account must exist**; otherwise `NOT_FOUND`.
- **One open report per reporter/reported-account pair.** A duplicate open report returns `ACCOUNT_ALREADY_REPORTED` (`CONFLICT`). After a previous report has been reviewed, the reporter may submit a new report about later misconduct.
- **Account Reports never automatically ban or suspend the reported account.** Reporting is distinct from blocking and does not change the relationship.
- **Blocks do not suppress reporting.** Reporting remains available for evidence purposes; administrators always see reports regardless of Blocks.

---

## 7. The Shared Report Allowance

- **Limit:** 10 successfully committed Post, Comment, or Pupzy Account Reports per reporting Pupzy Account per rolling 24 hours.
- **Concurrency-safe:** admissions are serialized per reporter in PostgreSQL, so concurrent report attempts cannot exceed the limit and alternating report types cannot bypass it.
- **Only commits count:** validation failures, self-reports, duplicates, and rolled-back transactions consume nothing. A retry after a network failure is therefore safe.
- **On exhaustion:** the mutation fails with `extensions.code = "RATE_LIMITED"`. `reportPost` and `reportUser` return the shared message `Daily report limit reached (10 per day)`, while `reportComment` preserves its existing message `Daily comment report limit reached (10 per day)`; both draw on the same 10-report allowance. The client should stop offering the report action, explain the daily cap, and allow retry after the rolling window passes. Do not retry immediately.

---

## 8. Stable Errors & Neutral Outcomes

### 8.1 Report errors

| `extensions.code` | When | Client behavior |
|---|---|---|
| `UNAUTHENTICATED` | No valid session | Re-authenticate |
| `VALIDATION_ERROR` | Invalid UUID, details > 500, `OTHER` without details, missing/partial/invalid source context (an invalid enum literal or wrong input type is rejected earlier by standard GraphQL input validation) | Show the offending field; do not count as a report attempt |
| `FORBIDDEN` | Self-report (`reportPost`, `reportComment`, `reportUser`) | Hide the action on own content; this indicates a UI bug |
| `NOT_FOUND` | Target Post/Comment not accessible or `REMOVED` | Show the neutral "no longer available" state |
| `POST_ALREADY_REPORTED` | The caller already reported this Post | Treat as **already reported**; hide or disable the action |
| `COMMENT_ALREADY_REPORTED` | The caller already reported this Comment/Reply | Treat as already reported |
| `ACCOUNT_ALREADY_REPORTED` | An open Account Report for this reporter/target already exists | Treat as already reported |
| `RATE_LIMITED` | Shared allowance exhausted (10 per rolling 24h) | Explain the daily cap; retry after the window |

### 8.2 Block-related neutral outcomes

There is deliberately **no** error code that reveals a Block. The API reuses ordinary outcomes:

- Feeds, Saved Posts, discussion lists, Contact Request lists, and Adoption Application lists **omit** blocked records.
- Nullable direct lookups (for example `post(id)`, `rescuePostDetail`, `matingPostDetail`) return **`null`**.
- Contact disclosure (`getWhatsAppLink`, `getProductSellerContact`) returns `NOT_FOUND` for an isolated pair and never returns a phone number or WhatsApp link.
- Cross-Block writes (Comment, Reply, Upvote, Save, Boost, Contact Request, Adoption Application) fail with the operation's ordinary inaccessible/not-found behavior.
- Notifications already delivered remain in the list; opening one whose target is now inaccessible shows the existing neutral unavailable screen.

The client must render these as **"This content isn't available"** or its existing equivalent. It must never say "You were blocked" or "You blocked this account" on the other party's behalf, and must never infer direction.

---

## 9. Block (`blockUser`) and Unblock (`unblockUser`)

### 9.1 Operations

```graphql
mutation BlockUser($userId: ID!) {
  blockUser(userId: $userId)
}

mutation UnblockUser($userId: ID!) {
  unblockUser(userId: $userId)
}
```

**Variables:**

```json
{ "userId": "01916327-0000-7000-8000-000000000020" }
```

### 9.2 Semantics

| Behavior | `blockUser` | `unblockUser` |
|---|---|---|
| Authentication | Required | Required |
| Self-target | `VALIDATION_ERROR` | `VALIDATION_ERROR` |
| Invalid UUID | `VALIDATION_ERROR` | `VALIDATION_ERROR` |
| Nonexistent target | `NOT_FOUND` | `NOT_FOUND` |
| Idempotency | Blocking an already-blocked account returns `true` without repeating cleanup | Unblocking an absent relationship returns `true` |
| Ownership | Creates the caller-owned Block | Removes **only** the Block owned by the caller; the other party's Block is never affected |
| Reports | Never creates a Report | Never creates a Report |
| Notifications | Never notifies the other party | Never notifies the other party |
| Atomic direct-interaction cleanup | In the same transaction, pending Contact Requests and Adoption Applications between the pair are rejected before `true` is returned | Does not reopen rejected requests or applications |

Once `blockUser` returns successfully, no new cross-Block interaction can commit after it, and the other account can no longer observe or contact the caller.

### 9.3 What the caller observes while blocked

- The blocked account's Posts disappear from the Home Feed, help, adoption, market, and mating feeds, from Saved Posts, and from direct/type-specific Post lookups.
- Their Comments and Replies disappear from discussions, including pinned Comments and whole Reply branches beneath a hidden top-level Comment.
- Post `commentCount` and Comment `replyCount` reflect only what the caller can reach.
- The caller's viewer-specific engagement booleans (`isUpvotedByMe`, `isSavedByMe`, `isBoostedByMe`) read `false` for hidden content while the underlying engagement is preserved internally.
- Pending Contact Requests and Adoption Applications between the pair disappear from both parties' lists and cannot be approved.
- No new notification is created in either direction. Historical notifications remain.
- Unblocking restores ordinary discovery, counts, and preserved engagement state, but does **not** reopen rejected requests/applications; `blockUser` → `unblockUser` → the account may appear again after the next refresh.

---

## 10. Blocked Accounts Screen (`blockedUsers`)

### 10.1 Operation

```graphql
query BlockedUsers($first: Int, $after: String) {
  blockedUsers(first: $first, after: $after) {
    edges {
      node {
        id
        fullName
        fullNameArabic
        profilePictureUrl
        isVerified
      }
      blockedAt
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### 10.2 Shape and field meanings

| Field | Type | Meaning |
|---|---|---|
| `edges` | `[BlockedUserEdge!]!` | Newest Block first |
| `edges[].node` | `BlockedUser!` | Minimal display identity only |
| `node.id` | `ID!` | Pupzy Account id (use for `unblockUser`) |
| `node.fullName` | `String` | Display name; null until profile completion |
| `node.fullNameArabic` | `String` | Arabic display name, when set |
| `node.profilePictureUrl` | `String` | Avatar URL, when set |
| `node.isVerified` | `Boolean!` | Existing verification badge |
| `edges[].blockedAt` | `DateTime!` | When **the caller** created the Block (ISO-8601 UTC) |
| `edges[].cursor` | `String!` | Opaque keyset cursor for this edge |
| `pageInfo.hasNextPage` | `Boolean!` | Whether another page exists |
| `pageInfo.endCursor` | `String` | Cursor of the last edge; pass as `after` for the next page |

`BlockedUserConnection` intentionally exposes **no** Posts, phone number, email, City, counts, reports, or Block reason, and `User` identity is reduced to the same display fields the app already renders.

### 10.3 Pagination contract

- `first` defaults to **20** and is capped at **50**. A non-numeric or non-finite value falls back to the 20 default; fractional values are floored; values below 1 are treated as 1; values above 50 are clamped to 50.
- Ordering is **newest Block first**, with the Block id as a unique tie-breaker (microsecond-stable).
- Treat `cursor`/`endCursor` as **opaque tokens**; never parse, construct, or store them long-term.
- Fetch pages with `first: 20, after: endCursor` while `pageInfo.hasNextPage` is `true`.
- An invalid or malformed cursor returns `VALIDATION_ERROR`.

### 10.4 Screen behavior

1. Enter from Profile → Settings/Privacy → **Blocked Accounts**.
2. Show the list with avatar, display name (localized: prefer `fullNameArabic` when the app language is Arabic, else `fullName`), the verification badge, and `blockedAt`.
3. Show a per-row **Unblock** action. Confirm before unblocking; after success, remove the row locally and invalidate cached feeds.
4. Empty state: explain that blocked accounts will appear here.
5. Loading, empty, error, and end-of-list states are required; use infinite scroll with the cursor contract above.
6. Never show Block direction, Block reason, or the other party's view anywhere in the app.

---

## 11. Recommended Action Menus

Menus are recommendations only; implementing them is the separate Flutter effort.

| Surface | Author is someone else | Author is the viewer |
|---|---|---|
| **Post** (feed card, detail) | Report Post · Report Account · Block Account | No Report/Block actions (owner may manage/delete the Post through existing operations) |
| **Comment / Reply** | Report Comment · Report Account · Block Account | No Report/Block actions (author may delete through existing operations) |
| **Contact Request** (received or sent) | Report Account · Block Account | — |
| **Adoption Application** (received or submitted) | Report Account · Block Account | — |
| **Own content anywhere** | — | Never show Report or Block for the viewer's own account |

Rules:

- Hide the menu entirely on the viewer's own account or own content.
- `Report Account` always reports `post.creator.id` / `comment.author.id` / the counterparty on a request or application — never the viewer.
- `Block Account` targets the same counterparty id.
- After a successful Report, offer Block as a separate optional follow-up (never automatic).
- After a successful Block from a Post/Comment surface, remove that author's content from the current list immediately and show the Block confirmation; the viewer stays on the screen.
- If `fullName` is null, render the app's existing anonymous/unknown-owner placeholder.

---

## 12. Recommended Call Sequences

### 12.1 Report a Post, then optionally Block the author

```
1. User taps Report Post
2. Show reason picker (content ReportReason values) + optional details
   (details required when OTHER is selected)
3. call reportPost(input)
4. On success:
     a. show "Thanks for reporting"
     b. show a separate, optional prompt: "Block this account too?"
        - "Not now" → done
        - "Block"  → call blockUser(userId: post.creator.id)
     c. Refresh or remove the reported item only if a Block was created
5. On POST_ALREADY_REPORTED → show "You already reported this" and stop
6. On RATE_LIMITED → show the daily-cap message and stop
```

### 12.2 Report a Comment/Reply, then optionally Block the author

Same shape as §12.1, using `reportComment(input: { commentId })` and `blockUser(userId: comment.author.id)`. A Block removes that author's entire visible discussion contribution, including a top-level Comment's Reply branch.

### 12.3 Report an Account from a Contact Request or Adoption Application

```
1. User taps Report Account
2. Show reason picker (AccountReportReason values) + optional details
3. Pre-attach source context:
     sourceType: "CONTACT_REQUEST" | "ADOPTION_APPLICATION"
     sourceId:   the request/application id
4. call reportUser(input)
5. On success: optionally offer "Block this account too?"
     → call blockUser(userId: counterpartyId)
6. The pending request/application is not changed by the Report; a Block
   atomically rejects it and removes it from both parties' lists
```

### 12.4 Block from a Post, Comment, or profile surface

```
1. User taps Block Account
2. Show confirmation explaining mutual isolation
3. call blockUser(userId)
4. On true: remove the account's content from the current list, show "Account blocked"
5. The action is private: never notify or reveal it to the other account
```

### 12.5 Blocked Accounts screen and Unblock

```
1. Open Blocked Accounts → call blockedUsers(first: 20)
2. Render rows; load more with after: pageInfo.endCursor while hasNextPage
3. User taps Unblock → confirm
4. call unblockUser(userId)
5. On true: remove the row locally and invalidate feed/discussion caches
```

### 12.6 Retry guidance

| Situation | Safe client behavior |
|---|---|
| `blockUser` / `unblockUser` network timeout | Retry blindly; both are idempotent and return `true` |
| `reportPost` / `reportComment` / `reportUser` network timeout | Retry once; if the duplicate code is returned, treat the report as submitted |
| `POST_ALREADY_REPORTED` / `COMMENT_ALREADY_REPORTED` / `ACCOUNT_ALREADY_REPORTED` | Do not retry; show the already-reported state |
| `RATE_LIMITED` | Do not retry immediately; wait for the rolling window and explain the 10-per-day cap |
| `NOT_FOUND` on a content interaction | Treat as unavailable; refresh the surface |

---

## 13. Copy Suggestions (English / Arabic)

### 13.1 Action labels

| Key | English | Arabic |
|---|---|---|
| Report Post | Report Post | الإبلاغ عن المنشور |
| Report Comment | Report Comment | الإبلاغ عن التعليق |
| Report Account | Report Account | الإبلاغ عن الحساب |
| Block Account | Block Account | حظر الحساب |
| Unblock | Unblock | إلغاء الحظر |
| Blocked Accounts | Blocked Accounts | الحسابات المحظورة |

### 13.2 Content report reasons (`ReportReason`)

| Value | English | Arabic |
|---|---|---|
| `UNRELATED_TO_ANIMALS` | Unrelated to animals | غير متعلق بالحيوانات |
| `SPAM` | Spam | محتوى مزعج |
| `INAPPROPRIATE_CONTENT` | Inappropriate content | محتوى غير لائق |
| `SCAM` | Scam or fraud | احتيال أو نصب |
| `DUPLICATE` | Duplicate listing | منشور مكرر |
| `OTHER` | Other | أخرى |

### 13.3 Account report reasons (`AccountReportReason`)

| Value | English | Arabic |
|---|---|---|
| `HARASSMENT` | Harassment or bullying | تحرش أو تنمر |
| `SPAM` | Spam | إزعاج أو محتوى مزعج |
| `SCAM_OR_FRAUD` | Scam or fraud | احتيال أو نصب |
| `IMPERSONATION` | Impersonation | انتحال شخصية |
| `INAPPROPRIATE_CONDUCT` | Inappropriate conduct | سلوك غير لائق |
| `SAFETY_CONCERN` | Safety concern | مخاوف تتعلق بالسلامة |
| `OTHER` | Other | أخرى |

### 13.4 Messages

| Situation | English | Arabic |
|---|---|---|
| Details hint | Add details (required for Other) | أضف تفاصيل (مطلوبة عند اختيار أخرى) |
| Report submitted | Thanks for reporting. We'll review it. | شكرًا لإبلاغك، سنراجع الأمر. |
| Already reported | You've already reported this. | لقد أبلغت عن هذا بالفعل. |
| Daily limit reached | You've reached the daily limit of 10 reports. Try again later. | لقد بلغت الحد اليومي وهو 10 تقارير. حاول مرة أخرى لاحقًا. |
| Report prompt | Block this account too? | هل تريد حظر هذا الحساب أيضًا؟ |
| Block confirmation | Block this account? You won't see each other's content or be able to contact each other. | هل تريد حظر هذا الحساب؟ لن تتمكنا من رؤية محتوى بعضكما أو التواصل. |
| Blocked | Account blocked. | تم حظر الحساب. |
| Unblock confirmation | Unblock this account? They may appear in your feed again. | هل تريد إلغاء حظر هذا الحساب؟ قد يظهر مرة أخرى في صفحتك الرئيسية. |
| Unblocked | Account unblocked. | تم إلغاء الحظر. |
| Blocked list empty | You haven't blocked anyone. | لم تقم بحظر أي حساب. |
| Blocked date | Blocked on {date} | تم الحظر في {date} |
| Neutral unavailable | This content isn't available. | هذا المحتوى غير متاح. |
| Not now | Not now | ليس الآن |
| Block | Block | حظر |
| Cancel | Cancel | إلغاء |

---

## 14. Compatibility Statement

- Every pre-existing GraphQL operation retains its name, arguments, argument types, result fields, field nullability, and enum values. The only schema changes are additive: the four new mutations, the new `blockedUsers` query, and the new `ReportPostInput`, `ReportUserInput`, `AccountReportReason`, `AccountReportSourceType`, `BlockedUser`, `BlockedUserEdge`, and `BlockedUserConnection` types.
- Existing feed, detail, discussion, contact, adoption, engagement, notification, Account Deletion, and `reportComment` clients continue to compile and behave normally when no Block applies.
- When a Block applies, the API reuses existing unavailable/not-found behavior rather than introducing new error shapes.
- Reproduce the proof with:
  ```
  cd backend && node scripts/graphql-schema-compat.mjs b6df50c HEAD
  ```
  See `docs/ugc-reporting-and-account-blocking-release-evidence.md` for the recorded result.
- **This document specifies the backend contract. Implementing the Report, Block, and Blocked Accounts UI in Flutter is a separate effort; this backend effort did not modify or add Flutter source or Flutter tests.**
