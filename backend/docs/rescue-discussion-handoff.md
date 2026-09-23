# Backend Handoff: Rescue Ordinary Discussion & Creator Closure

**Document version:** 1.0.0  
**Associated Ticket:** Ticket 01 (`01-use-ordinary-rescue-discussion-and-creator-closure`)  
**Target Audience:** Flutter Frontend Developers, Backend Engineers, QA  

---

## 1. Overview & Architectural Principles

Ticket 01 unifies Rescue post updates and resolution around Pupzy's existing Community Evidence and discussion infrastructure:

1. **Ordinary Discussion for Rescue Updates:** Rescue participants and community members share situation updates, location notes, and photos through existing top-level **Comments**, image attachments (up to 2 per comment), single-level **Replies**, and **Boosts**.
2. **One Creator-Selected Pin:** The rescue post creator can pin exactly one top-level comment to highlight critical updates (e.g. "Animal was caught and is at the clinic"). Replacing or unpinning is creator-controlled.
3. **No Proof Submission/Approval Workflow:** There is no separate "Rescue Proof" form, proof entity, proof approval queue, or proof review state machine. Proof APIs are omitted from the backend GraphQL schema. Community Evidence is provided through ordinary discussion.
4. **Rescued Closure with No Evidence Gate:** The post creator retains direct authority to mark the post as `RESOLVED` (Rescued) at any time. Closure is **not** gated on a comment, an image, a pin, or any engagement threshold. Non-owners cannot close the post.
5. **No Automatic Resolution:** Boosts, upvotes, comments, and pins are engagement and communication mechanisms only; they never trigger automatic post status transitions.

---

## 2. API Operations for Rescue Discussion

Rescue screens use the standard Comments and Engagement GraphQL operations.

### 2.1 Viewing Discussion

Fetch paginated top-level comments for a Rescue post:

```graphql
query RescueComments($postId: ID!, $sort: CommentSort, $first: Int, $after: String) {
  comments(postId: $postId, sort: $sort, first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        postId
        text
        status
        replyCount
        boostCount
        isBoostedByMe
        isPinned
        createdAt
        author {
          id
          fullName
          avatarUrl
        }
        media {
          id
          publicUrl
          width
          height
          displayOrder
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

*Sort Options:*
- `TOP`: Comments sorted by `boostCount DESC, createdAt DESC`.
- `NEWEST`: Comments sorted chronologically by `createdAt DESC`.

### 2.2 Adding an Update (Text or Image Comment)

Image attachments are explicitly enabled for `RESCUE` (and `LOST`) listings as Community Evidence.

#### Step 1: Upload Image (if attaching photos)
Request a presigned direct upload ticket:
```graphql
mutation RequestCommentImageUpload($input: RequestCommentImageUploadInput!) {
  requestCommentImageUploadUrl(input: $input) {
    mediaId
    uploadUrl
    expiresAt
    maxSizeBytes
    maxWidth
    maxHeight
    allowedContentType
  }
}
```
Client PUTs the WebP binary to `uploadUrl`, then uses `mediaId`.

#### Step 2: Publish Comment
```graphql
mutation CreateRescueComment($input: CreateCommentInput!) {
  createComment(input: $input) {
    id
    postId
    text
    replyCount
    boostCount
    isBoostedByMe
    isPinned
    media {
      id
      publicUrl
    }
    createdAt
  }
}
```
**Variables:**
```json
{
  "input": {
    "postId": "01916327-0000-7000-8000-000000000010",
    "text": "The dog was safely picked up by local volunteers and taken to Cairo Vet Clinic.",
    "clientRequestId": "01916327-0000-7000-8000-000000000099",
    "mediaIds": ["01916327-0000-7000-8000-000000000088"]
  }
}
```

### 2.3 Creator Pinning & Unpinning

The post creator can pin one top-level comment to elevate critical status updates.

```graphql
# Pin comment (creator-only, atomically replaces any existing pin for this post)
mutation PinComment($commentId: ID!) {
  pinComment(commentId: $commentId) {
    id
    isPinned
  }
}

# Unpin comment (creator-only)
mutation UnpinComment($postId: ID!) {
  unpinComment(postId: $postId)
}
```

- If a non-creator attempts to pin or unpin, the backend rejects with `FORBIDDEN` (`ForbiddenError: Only the post author can pin comments`).
- Replies cannot be pinned; only top-level comments can be pinned (`ValidationError`).

### 2.4 Boosting Discussion Comments

Boosts allow community members to prioritize helpful comments.

```graphql
mutation ToggleCommentBoost($commentId: ID!) {
  toggleCommentBoost(commentId: $commentId) {
    commentId
    isBoostedByMe
    boostCount
  }
}
```

- Reversible toggle (adds boost if absent, removes if present).
- Users cannot boost their own comments.
- Boosts do **not** constitute resolution votes and never alter post lifecycle state.

---

## 3. Absence of Unsupported Proof Endpoints

The backend strictly omits separate rescue proof schemas and endpoints:

| Conceptual Operation | Status in Backend | Replacement Workflow |
|---|---|---|
| `submitRescueProof` | **Omitted / Does not exist** | Community members post comments and photos via `createComment` with `mediaIds`. |
| `approveRescueProof` | **Omitted / Does not exist** | Post creator or administrator decides outcome; no proof review state machine. |
| `rejectRescueProof` | **Omitted / Does not exist** | N/A |
| `rescueProofDetail` / `proofs` | **Omitted / Does not exist** | Discussion thread queried via `comments(postId: ...)`. |
| Proof-specific phone unlock | **Omitted / Does not exist** | Phone disclosure on rescue follows standard contact policies; no proof gate. |

Any client attempts to invoke proof mutations or query proof types will fail at the GraphQL validation boundary (`Cannot query field ... on type ...`).

---

## 4. Creator & Administrator Closure Authority

### 4.1 Creator Rescued Closure (No Evidence Gate)

The post creator closes an active Rescue post by calling `updatePostStatus`:

```graphql
mutation CloseRescuePost($postId: ID!) {
  updatePostStatus(postId: $postId, status: RESOLVED) {
    id
    status
    postType
  }
}
```

#### Authority & Validation Rules:
1. **Creator-Only Authority:** Only the account that created the post (`post.creator_id === ctx.user.id`) can close it. Requests from any other authenticated user throw `ForbiddenError` (`"You can only update the status of your own posts"`).
2. **Allowed Target Status:** For `RESCUE` posts, `RESOLVED` (representing "Rescued") is the only valid closure target. Attempting to transition to `REUNITED`, `ADOPTED`, `SOLD`, or other targets throws `ValidationError`.
3. **No Evidence Gate:** The creator can close the post immediately even if the post has:
   - 0 comments
   - 0 uploaded images
   - 0 pinned comments
   - 0 boosts, upvotes, or saves
   - 0 views
4. **Optional Frontend Encouragement:** The frontend UI may encourage the creator to post a closing update comment or thank volunteers when closing, but this must remain optional and never block the closure mutation.
5. **Irreversible by Owner:** An owner cannot reopen a closed post or close it a second time. Attempting to close an already-`RESOLVED` post throws `ValidationError` (`"Post is already in \"RESOLVED\" status and cannot be changed"`).

### 4.2 Administrator Closure

Administrators can record a rescue resolution in AdminJS via the `markRescued` action:
- Moves `status` from `ACTIVE` to `RESOLVED`.
- Logs a moderation audit row (`action_type: POST_RESOLVED`).
- Sends a bilingual push notification to the creator (`POST_RESOLVED_BY_ADMIN`).
- Terminates pending direct interactions.
- Has no evidence gate (comments or proofs are not required).

---

## 5. Non-Rescue Callers Retained Behavior

Post closure transitions for non-rescue listing types remain completely unchanged:

| Post Type | Discriminator / Context | Allowed Owner Closure Target(s) | Notes |
|---|---|---|---|
| `RESCUE` | N/A | `RESOLVED` | Rescued outcome. No evidence gate. |
| `LOST` | `FOUND_STRAY` | `RESOLVED`, `REUNITED` | Retains dual resolution for finders. |
| `LOST` | `LOST_PET` | `REUNITED` | Owner reunited with pet. Rejects `RESOLVED`. |
| `ADOPTION` | N/A | `ADOPTED` | Atomically terminates pending applications. |
| `PRODUCT` | N/A | `SOLD` | Atomically terminates pending contact requests. |
| `MATING` | N/A | `RESOLVED` | Atomically terminates pending contact requests. |

---

## 6. Regression Verification Matrix

The guarantees in this document are guarded by backend automated tests:

| Test File | Verified Invariant |
|---|---|
| `src/posts/rescue-discussion-authority.spec.ts` | GraphQL schema contract: omits all proof mutations/queries/fields; verifies ordinary discussion fields on `Comment`; unit tests creator rescue closure with 0 comments/images/pins (zero evidence gate); rejects non-owners (`FORBIDDEN`); verifies non-rescue callers retention; checks admin authority. |
| `src/posts/post-lifecycle.integration.spec.ts` | Database integration test for `['RESCUE', 'RESOLVED']` owner closure, non-owner rejection, concurrent closure serialization, and discovery removal. |
| `src/comments/comment-image-eligibility.spec.ts` | Confirms `RESCUE` and `LOST` allow image comments; rejects `ADOPTION`, `PRODUCT`, and `MATING`. |
| `src/comments/comments-schema.contract.spec.ts` | Verifies `Comment` schema omits `proof`, `resolutionVote`, `evidenceProof`, `unlockPhone`, and phone fields. |
| `src/posts/owner-post-closure.integration.spec.ts` | Verifies owner closure lifecycle across post types, interaction termination, and block boundary isolation. |
