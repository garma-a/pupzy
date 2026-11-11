# Neighbourhood Cities: final implementation report — 2026-11-11

**Mergeable: yes.** The normal publisher prepared the single replacement 0066, catalog, combined snapshot and journal without a waiver or review-only marker. **3,156 OFFICIAL Cities = 351 districts + 2,805 Neighbourhoods in 27 governorates**; catalog bytes and all City data are unchanged from lead checkpoint 679e972. No commit, push, PR or production action was performed.

| Area | Grid samples / uncovered / share / floor | Names | GPS |
|---|---|---|---|
| greater-cairo | 8,469 /270 /96.812% /96.8% — PASS | 418 names — PASS | 30/30 — PASS |
| alexandria | 2,146 /192 /91.053% /91% — PASS | 268 names — PASS | 30/30 — PASS |
| port-said-region | 734 /38 /94.823% /94.5% — PASS | 85 names — PASS | 29/30 — PASS |

**Headlines 141/141 PASS; structural/geographic/display quality PASS (zero errors); near/قرب qualifiers 0.** All 360 uncovered features have current reviewed notes; 68 beyond 4 km have individual research. Fourteen known-missing names remain client-visible under committed research/lead approvals. Q138196168 is the sole individually documented GPS failure.

The 2026-11-11 lead amendment sets Greater Cairo’s floor to 96.8%; Alexandria 91% and Port Said 94.5% stay unchanged. The exact reason is preserved verbatim in [ADR 0009](adr/0009-neighbourhoods-as-selectable-cities.md), the [runbook](neighbourhood-cities-runbook.md) and `residential-grid-review.json`. Non-half-percent calibrations require a dated reviewed lead decision matching the exact floor; stale approval and share regression tests fail. No geometry, point, fixture, name, alias or individual exception note changed.

**0066: 2,827,308 bytes; measured apply 0.613485s / re-run 0.860769s.** All four installed artifacts match verified staging. SQL checks preserve UUIDs/references, parent hierarchy, canonical/source names, idempotence and no-op redeploy behavior; no 0067 exists.
Data totals **20,727,099 bytes (19.767 MiB)**. All 334 raw/compressed source hashes verify. Point audit: 2,805 rows, 2,803 exact source points + 1 source geometry + 1 pre-existing documented coastal correction. Sources, licence limitations and landmark proxies remain explicit in the manifest/NOTICE.

Final checks (all PASS; none skipped):

```sh
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand # 18 suites /195 tests
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
npm run cities:verify-coverage # exit 0
python3 src/cities/scripts/verify-neighbourhood-sql.py
python3 src/cities/scripts/verify-source-points.py
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities # 3 Docker suites /17 tests
```

Accepted display/identity work and real village/housing restorations remain in `resident-review-audit.json.gz`, `round9-catalog-review.json.gz` and `round9-decision-delta.json.gz`. Exact-name dispositions, known-missing research, historical grid research and the complete remaining feature/name list stay in compressed audits. Those retain their historical floor context; the active floor authority is `residential-grid-review.json`. The runbook describes offline rebuilding and normal publication.
