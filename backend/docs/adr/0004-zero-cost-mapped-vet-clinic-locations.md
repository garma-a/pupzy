---
status: accepted
date: 2026-08-28
---

# Zero-cost mapped locations for administrator-managed Vet Clinics

New manual Vet Clinics and administrative location changes use a Leaflet map picker over configurable OpenStreetMap tiles. The administrator selects an official Pupzy City, confirms Arabic and English addresses, and fixes a WGS84 point inside Egypt; an optional explicit Search action may query public Nominatim under its usage limits, but autocomplete is prohibited and saving never depends on that service.

Pupzy stores the confirmed point and addresses permanently, validates their shape and database geometry, records audited City-disagreement overrides, and exposes a zero-key Google Maps search URL generated from the stored coordinates for an explicit Flutter handoff. This supersedes ADR-0003 because Google Places requires billing and imposes storage and display constraints that conflict with Pupzy's zero-paid-API launch requirement; Pupzy makes no claim that Google or OpenStreetMap independently verifies the real-world clinic or address.

The checked-in OpenStreetMap Vet Clinics remain Imported Vet Clinics and require a Mapped Location only when an administrator changes their location. Public map tiles and Nominatim are best-effort conveniences with visible attribution and configurable endpoints, not availability dependencies.

See the supporting primary-source research in `.scratch/adminjs-admin-experience/research/zero-cost-mapped-location.md`.
