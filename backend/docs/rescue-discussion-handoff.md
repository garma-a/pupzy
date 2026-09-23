# Rescue Discussion & Closure Authority Handoff

## Summary
This document records the architectural and integration contract for Rescue Posts, Community Evidence, and Closure Authority (Ticket 01):
1. **Ordinary Rescue Discussion**: Rescuers and community members share updates through standard Comments, Comment Images, creator-selected Pinned Comment, and Boosts.
2. **No Unsupported Proof APIs**: The backend exposes no separate proof submission, review, approval, or verification endpoints (e.g. `submitRescueProof`, `confirmRescueProof`). All evidence lives within the ordinary discussion feed.
3. **Creator/Admin Closure Authority**: Only the Post creator or an administrator can close a Rescue Post to `RESOLVED` (Rescued). Nonowners cannot close.
4. **No Evidence Gate**: Closure as `RESOLVED` does not require any minimum number of comments, images, pins, or boosts. The creator is encouraged to share an update, but closure is never blocked by an evidence threshold.
5. **Non-Rescue Callers**: Other listing verticals retain their distinct completion outcomes:
   - `LOST` (`LOST_PET` → `REUNITED`; `FOUND_STRAY` → `RESOLVED` or `REUNITED`)
   - `ADOPTION` → `ADOPTED`
   - `PRODUCT` → `SOLD`
   - `MATING` → `RESOLVED`

## GraphQL API Contract
- Status transitions are performed via the existing `updatePostStatus` mutation:
  ```graphql
  mutation CloseRescue($postId: ID!, $status: PostStatus!) {
    updatePostStatus(postId: $postId, status: $status) {
      id
      status
      resolvedAt
    }
  }
  ```
- Pass `status: RESOLVED`.
- Rejection codes:
  - `FORBIDDEN`: When a nonowner attempts to update the status.
  - `VALIDATION_ERROR`: When attempting an invalid status transition (e.g. `ADOPTED` on a rescue post, or repeating closure on an already resolved post).
