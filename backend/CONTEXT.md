# Pupzy

Pupzy connects pet owners and animal-care communities through location-aware listings and services.

## Language

**City**:
An authoritative selectable Egyptian ADM2 area (Markaz, Kism, or new urban community) across Egypt's 27 governorates, managed through reviewed local dataset releases. Each City maintains canonical English and Arabic names, an internal source identity, an explicit lifecycle state (`official`, `legacy`, or `retired`), and an approximate WGS84 representative point for distance-based discovery.
_Avoid_: City record, location entry, custom city creation, operator-created city

**Mapped Location**:
An approximate place visually selected and confirmed by an administrator. It retains administrator-confirmed Arabic and English addresses and a fixed WGS84 coordinate point, but does not claim that a map provider independently verified the place or address.
_Avoid_: Google GPS, Verified Location, provider-validated address, raw coordinates

**Imported Vet Clinic**:
A Vet Clinic initialized from a reviewed offline dataset rather than entered manually by an administrator. Its existing location remains usable, but any administrative location change must replace it with a Mapped Location.
_Avoid_: Legacy clinic, unverified clinic

**Post**:
A user-created listing for pet-related help, adoption, commerce, or mating. A Post has one specific listing type and may be shown in location-aware feeds.

**Home Feed**:
The combined location-aware feed of active Posts of every listing type, including mating Posts.

**Removed Post**:
A Post made unavailable by an administrative takedown. Its base record and type-specific details are inaccessible to clients and cannot receive engagement while removed, but an administrator may restore it with its prior moderation status intact.
_Avoid_: Hidden Post, deleted Post, permanently removed Post

**Staged Upload**:
A media object that has been uploaded for later attachment to a Post but has not yet been finalized as that Post's media. A Staged Upload may be attached only by its owner.

**Comment**:
A user-created contribution published beneath a Post to participate in its discussion. A top-level Comment requires trimmed plain text (1 to 1,000 Unicode characters) and belongs to one Post and one User. A Comment may later support attached images, Replies, Boosts, and moderation actions. Comments are allowed on every non-Removed Post type, but a Removed Post exposes no discussion and rejects new Comment creation.

**Reply**:
A user-created plain text contribution (1 to 500 Unicode characters) published directly beneath an active top-level Comment. Unlike a top-level Comment, a Reply cannot attach media, cannot receive further Replies (limiting discussion threads to one level of nesting), and belongs to the parent Comment's Post discussion thread. A Reply cannot be created beneath inaccessible, deleted, or administratively removed content. Deleting a Reply transactionally decrements both its parent Comment's reply count and the Post's comment count.
_Avoid_: Nested reply, sub-comment, thread comment, comment reply

