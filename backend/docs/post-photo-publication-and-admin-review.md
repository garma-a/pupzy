# Post photos: publication and administrator review

Every newly published Rescue, Lost/Found, Adoption, Product or Mating Post must
have at least one successfully uploaded photo, with a maximum of four. A supplied
media ID alone is insufficient: the existing staged-upload ownership, object
verification and finalization checks must succeed before Post persistence.

## API and existing app compatibility

The mutation names, input field types/nullability and response shapes remain the
same. Rescue, Lost/Found, Adoption and Product reject an omitted or empty
`mediaIds` list with the existing GraphQL `VALIDATION_ERROR` format and this
message:

> At least one photo must upload successfully before publishing. Please upload a photo and try again.

Mating retains its existing requirement for at least one photo. Its non-null
GraphQL media field also retains its existing schema-level error when omitted.

The installed Flutter client's existing error extraction returns the server
message to the posting form, which displays it and resets its loading state.
The backend protection can therefore ship before a mobile app update.

The small Flutter change is confined to the posting form. All six forms share
the guarded upload step. When no photo uploads successfully, no create mutation
is sent, a localized retry message is shown, and the selected photos and draft
fields remain. Unexpected upload errors are handled the same way. Partial
success preserves the existing behavior: only successfully uploaded photos are
submitted, with a warning about omitted photos. An interrupted publication
response does not cause an automatic create retry; users are told to check
My Posts first.

This is an intentional tightening of the earlier text-only creation policy.
It requires no database migration, modifies no existing Post, and does not alter
owner-deletion cleanup or administrative media retention.

## Admin display issue and correction

The original photo-review workspace was attached only to the main **Posts**
resource. The **Post Media** resource rendered its `public_url` as text, and the
five type-specific **Post Details** resources rendered their extension fields
without a gallery. Their custom UUID display also did not provide a route to
the main Post review. An image could consequently exist and load in the app
while those admin pages displayed no preview.

Post Media now renders a thumbnail on list and show pages. Its show page links
to the main Post for moderation; the thumbnail opens the original image. The
type-specific detail pages reuse the existing photo/discussion review workspace,
show the main Post's lifecycle status, and link to its moderation actions.
Discussion pagination resolves the parent `post_id`, and all detail/media
resources retain their read-only permissions.

No attachments and an unavailable image are different cases. Empty attachment
lists say that no photos are currently attached. A failed image request shows an
unavailable-image fallback. Owner deletion can remove attachments and storage
objects while a retained Removed Post and its type-specific details remain in
the admin. Administrative removal retains the existing photos for review.

## Verification

- GraphQL HTTP regressions cover missing/empty photos, missing storage objects,
  failed finalization, and normal publication across all Post types.
- Database integration checks verify that rejected publication creates no Post,
  extension or media rows; existing real image verification/finalization tests
  continue to run.
- Flutter checks cover existing-client error compatibility, failed ticket/byte
  uploads, disappeared local files, draft/spinner recovery, retry, partial
  success, and ambiguous publication errors.
- Real-browser admin regressions cover visible Post Media thumbnails, full-image
  links, type-specific photos, discussion pagination, and Mating Post context
  available to an ordinary administrator.
