# Rescue evidence and closure authority

Status: accepted; specification published; implementation pending

Rescue evidence stays in ordinary Comments with existing images, pins, and Boosts. Community members use that evidence to assess what happened, while only the Post creator or an administrator changes official status; neither engagement counts nor an individual proof submission automatically closes the Post. This retains the existing authority model and accepts that an absent creator may require administrative intervention, avoiding a new voting system or treating popularity as proof of rescue.

A separate rescue-proof submission and owner-approval workflow is outside this model. Existing frontend rescue entry points for that workflow must be replaced with the ordinary discussion flow.

Rescued means immediate danger is addressed and appropriate care secured, without requiring permanent adoption. Animal deceased is a distinct closure outcome available only for RESCUE in this release and must not be presented as successful rescue. Closure notifies eligible post Boosters, savers, commenters, contact requesters, and adoption applicants, with deduplication, block and preference filtering, and exclusion of the closing actor; completion notifications cover every supported Post type and are delivered to all eligible recipients in durable background batches without an arbitrary cap. Deletion, moderation removal, and expiry are excluded.

Existing comment-image, single creator-selected pin, and Boost functionality is reused. Closure may proceed without a supporting image, comment, pin, or engagement minimum; discussion updates are encouraged rather than required.

Eligibility is captured at closure, with access and preferences rechecked before delivery. Reopening suppresses pending obsolete closure messages and sends corrections to previously notified participants. The existing setting continues to suppress push only, preserving the in-app inbox.

The audience includes current post Boosters and savers, authors of existing top-level Comments and Replies, and contact requesters and adoption applicants of any status. Contributions deleted or removed before closure do not establish eligibility.
