# Pupzy

Pupzy connects pet owners and animal-care communities through location-aware listings and services.

## Language

**City**:
An authoritative selectable Egyptian ADM2 area (Markaz, Kism, or new urban community) across Egypt's 27 governorates, managed through reviewed local dataset releases. Each City maintains canonical English and Arabic names, an internal source identity, an explicit lifecycle state (`official`, `legacy`, or `retired`), and an approximate WGS84 representative point for distance-based discovery.
_Avoid_: City record, location entry, custom city creation, operator-created city

**Post**:
A user-created listing for pet-related help, adoption, commerce, or mating. A Post has one specific listing type and may be shown in location-aware feeds.

**Home Feed**:
The combined location-aware feed of active Posts of every listing type, including mating Posts.

**Removed Post**:
A Post that is no longer publicly available. Its base record and type-specific details are inaccessible to clients, and it cannot be revived or receive engagement.

**Staged Upload**:
A media object that has been uploaded for later attachment to a Post but has not yet been finalized as that Post's media. A Staged Upload may be attached only by its owner.
