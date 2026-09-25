---
status: superseded by ADR-0004
date: 2026-08-28
---

# Google-verified locations for administrator-managed Vet Clinics

New manual Vet Clinics and administrative location changes use a fixed Google Place selected through server-proxied Places API autocomplete and re-resolved by Place ID before storage. Pupzy retains the Place ID permanently, caches Google-derived Arabic and English addresses and WGS84 coordinates for no more than 30 days, displays that content spatially only with Google Maps, and does not allow manual coordinate fallback; this accepts periodic refresh cost in exchange for a provider-confirmed place identity and consistent Flutter display.

Pupzy City remains a separate authoritative classification selected from official Cities. A geographic disagreement requires an explicit audited administrator confirmation because Google address components and Pupzy ADM2 boundaries are not equivalent; the checked-in OpenStreetMap Vet Clinics remain Imported Vet Clinics and require Google verification only when an administrator changes their location.

See the supporting primary-source research in `.scratch/adminjs-admin-experience/research/google-verified-location.md`.
