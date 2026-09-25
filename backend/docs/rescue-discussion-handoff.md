# Rescue Discussion & Closure Authority Handoff

## Summary

This document records the architectural and integration contract for Rescue Posts, Community Evidence, and Closure Authority (Ticket 01):

1. **Ordinary Rescue Discussion**: Rescuers and community members share updates through standard Comments, Comment Images, creator-selected Pinned Comment, and Boosts.
2. **No Unsupported Proof APIs**: The backend exposes no separate proof submission, review, approval, or verification endpoints (e.g. `submitRescueProof`, `confirmRescueProof`). All evidence lives within the ordinary discussion feed.
3. **Creator/Admin Closure Authority**: Only the Post creator or an administrator can close a Rescue Post to `RESOLVED` (Rescued) or `ANIMAL_DECEASED` (Animal deceased). Nonowners cannot close.
4. **No Evidence Gate**: Neither `RESOLVED` nor `ANIMAL_DECEASED` requires any minimum number of comments, images, pins, or boosts. The creator is encouraged to share an update, but closure is never blocked by an evidence threshold.
5. **Death Is Never Rescued**: `ANIMAL_DECEASED` is a completed outcome but never a successful rescue. Death is never labelled Rescued in status labels, notifications, or corrections, and only RESCUE permits `ANIMAL_DECEASED`.
6. **Non-Rescue Callers**: Other listing verticals retain their distinct completion outcomes:
   - `LOST` (`LOST_PET` → `REUNITED`; `FOUND_STRAY` → `RESOLVED` or `REUNITED`)
   - `ADOPTION` → `ADOPTED`
   - `PRODUCT` → `SOLD`
   - `MATING` → `RESOLVED`

## Authoritative Contracts

- Outcome, transition, side-effect and rollout rules: `backend/docs/post-lifecycle-transition-contract.md`.
- Localized notification copy, `relatedPostId` routing, and client rendering: `backend/docs/notification-language-flutter-integration-contract.md`.

## GraphQL API Contract

- Status transitions are performed via the existing `updatePostStatus` mutation:
  ```graphql
  mutation CloseRescue($postId: ID!, $status: PostStatus!) {
    updatePostStatus(postId: $postId, status: $status) {
      id
      status
    }
  }
  ```
- Pass `status: RESOLVED` to record a rescue, or `status: ANIMAL_DECEASED` to record that the animal died. Both are valid only while the rescue is `ACTIVE`. The `Post` type in `backend/src/posts/posts.graphql` exposes no `resolvedAt` field, so select only real fields such as `id` and `status`.
- `PostStatus` (`backend/src/posts/posts-enums.graphql`) includes both `RESOLVED` and `ANIMAL_DECEASED`.
- Rejection codes:
  - `FORBIDDEN`: When a nonowner attempts to update the status.
  - `VALIDATION_ERROR`: When attempting an invalid status transition, including:
    - a non-RESCUE Post targeting `ANIMAL_DECEASED`,
    - a different type's outcome on a rescue Post (e.g. `ADOPTED`),
    - repeating closure on a Post already in a completed outcome.
