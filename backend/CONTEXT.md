# Pupzy

Pupzy connects pet owners and animal-care communities through location-aware listings and services.

## Language

**Pupzy Account**:
A person's membership in Pupzy, including their profile and community participation. A person who registers again after deleting their Pupzy Account starts fresh, without restored content.
_Avoid_: Apple account, Firebase account

**Account Deletion**:
Permanent removal of a Pupzy Account, its owned Posts and uploaded photos, and associated personal information, subject to established retention obligations. This includes unresolved rescue and lost-pet Posts and is distinct from a reversible administrative takedown.
_Avoid_: Deactivation, suspension

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
A user-created contribution published beneath a Post to participate in its discussion. A top-level Comment requires trimmed plain text (1 to 1,000 Unicode characters) and belongs to one Post and one User. A Comment may include attached images only when its Post is a rescue or lost/found listing; text Comments are supported on every Post type. Comments may have Replies, Boosts, and moderation actions. Comments are allowed on every non-Removed Post type, but a Removed Post exposes no discussion and rejects new Comment creation.

**Reply**:
A user-created plain text contribution (1 to 500 Unicode characters) published directly beneath an active top-level Comment. Unlike a top-level Comment, a Reply cannot attach media, cannot receive further Replies (limiting discussion threads to one level of nesting), and belongs to the parent Comment's Post discussion thread. A Reply cannot be created beneath inaccessible, deleted, or administratively removed content. Deleting a Reply transactionally decrements both its parent Comment's reply count and the Post's comment count.
_Avoid_: Nested reply, sub-comment, thread comment, comment reply

**Boost**:
A positive, reversible engagement signal that an authenticated user can give to a Post, top-level Comment, or Reply to increase its visibility in ranked views. A user can have at most one Boost relationship with a target and cannot Boost their own contribution. Adding or removing a Boost transactionally updates the target's denormalized counter. In discussion threads, visible top-level Comments can be ordered by TOP ranking based on Boost count.
_Avoid_: Comment upvote, comment like, upvote comment, thread upvote

**Post Report**:
A moderation complaint submitted by one Pupzy Account about a specific Post. It is distinct from blocking the Post's creator.
_Avoid_: Post flag, user report

**Comment Report**:
A moderation complaint submitted by one Pupzy Account about a specific Comment or Reply. It is distinct from reporting the author's Pupzy Account.
_Avoid_: Comment flag, Post Report

**Pupzy Account Report**:
A moderation complaint submitted about another Pupzy Account's conduct rather than about one specific contribution.
_Avoid_: User report, account flag, Post Report

**Block**:
A reversible, directional safety relationship initiated and owned by one Pupzy Account that creates mutual visibility and interaction isolation between it and another Pupzy Account. Only the initiating Pupzy Account can remove the Block.
_Avoid_: Ban, suspension, mute, one-way hide


**Terms Acceptance**:
A Pupzy Account holder's recorded agreement to a specific published version of Pupzy's terms, including when they accepted it. Agreement to an earlier version does not constitute acceptance of a later version.

**Community Evidence**:
Photos and discussion shared in Comments on a rescue or lost/found Post to help assess what happened to the animal. Community Evidence informs owner or administrator decisions but does not automatically resolve a Post or constitute independent verification by Pupzy.
_Avoid_: Rescue Proof application, resolution vote

**Post Resolution**:
An owner or administrator decision that the outcome of a Post has been reached, informed where appropriate by Community Evidence. A Post Resolution is distinct from removal for moderation, owner deletion, or expiry through inactivity.

**Expired Post**:
An adoption or product Post taken out of active discovery because of inactivity, with its photos retained so its owner can renew it. Expiry does not mean the Post was successfully resolved or removed for a moderation violation.
