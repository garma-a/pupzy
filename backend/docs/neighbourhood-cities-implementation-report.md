# Neighbourhood Cities: implementation report — 2026-11-11

**3,156 OFFICIAL Cities = 351 districts + 2,805 Neighbourhoods, 27 governorates.** Dataset gates and all 15 supported repository stage runs pass. Full `npm run verify:release` refuses an uncommitted worktree; this session cannot commit. The lead must commit and rerun the full gate before merge. No gate was weakened.

| Area | Grid samples / gaps / share / floor | Names | GPS |
|---|---|---|---|
| greater-cairo | 8469 / 270 / 96.812% / 96.8% PASS | 411 PASS | 30/30 PASS |
| alexandria | 2146 / 192 / 91.053% / 91% PASS | 264 PASS | 30/30 PASS |
| port-said-region | 734 / 38 / 94.823% / 94.5% PASS | 85 PASS | 29/30 PASS |

Headlines141/141; data quality zero errors; near/قرب zero; all 360 grid exceptions reviewed; 14 client-visible known-missing entries. Floors and coordinates are unchanged. The lead amendment remains verbatim in ADR 0009, the runbook and gate metadata.

Prettier formats all 35 derived metadata JSONs and catalog/snapshot/journal before publication hashing. No `.prettierignore` exemption was added. Raw 335 snapshots verify, with all 334 previous response bytes unchanged. Reviewed input/decision signatures, independent-name/GPS evidence references, source digests, derived-artifact hashes and all four publication hashes were recomputed through the offline pipeline. `pr27-source-decision-review.json.gz` proves zero source-decision changes.

Alias review: 280 removed, 70 added, 11,279 remain across 258 affected Cities (268,483 compact UTF-8 array bytes). Class cleanup removes 196 comma-joined, 32 administrative-composite, 17 non-ASCII Latin and 3 other-City district aliases; 32 further old aliases were displaced by the four-variant priority. Joined/spaced Arabic variants take priority; Porto and the complete word كفرة are not split; Mohandseen works; Ibrahimia no longer matches Sidi Gaber. `search.ts` is unchanged. Twelve composite ADM3 checklist labels were removed and one independently attested New Damietta 3rd District entry added; minima 150/150/85 and known-missing approvals are unchanged.

Arabic-field files: `src/cities/cities.graphql`, generated `src/graphql.ts`, `src/database/schema/cities.schema.ts`, migrations0065/0066, `src/cities/catalog.ts`, `release-sql.ts`, `migration.ts`, `reconcile.ts`, resolver/repository/service specs and Vet Clinic typed fixtures. `governorateArabic: String!` is persisted by 0065 and the 0066 create/backfill/upsert path, catalog mapping and reconciliation. The 0066 fallback handles a previously applied original 0065; SQL verification explicitly exercises that case. SDL, generated `src/graphql.ts`, schema, resolver/repository tests and typed fixtures were updated. The 27 English governorate strings are pinned to `main`.

| Stage | Result | Tests |
|---|---|---|
| 1. env-prereqs | PASS | — |
| 2. format-root | PASS | — |
| 3. format-admin | PASS | — |
| 4. glossary-root | PASS | 3 |
| 5. glossary-admin | PASS | 3 |
| 6. lint-root | PASS | — |
| 7. build-root | PASS | — |
| 8. unit-root | PASS | 1275 |
| 9. unit-admin | PASS | 421 |
| 10. migration-verification | PASS | 8 |
| 11. reset-verification | PASS | 23 |
| 12. integration-root | PASS | 729 |
| 13. integration-admin | PASS | 185 |
| 14. browser-admin | PASS | 31 |
| 15. e2e-root | PASS | 9 |

Initial failures and corrections: formatted 21 flagged JSONs through the generators/publisher; removed a stale comma-alias assertion; migration fixtures use a distinct name; reset verifies the complete catalog and revision 2; Admin HTTP fixtures use released identities and nearest real sub-areas rather than obsolete assumptions. Existing Admin dependencies are reused through an ignored symlink, with no host reinstall. Docker excludes nested node_modules; Buildx scratch state uses `/tmp/pupzy-pr27-buildx` because the default home state is read-only. Browser suite timeouts under overlapping heavy runs were not waived; final browser runs use unchanged deadlines and no skips.

Single normal 0066: **3,100,872 bytes; SQL apply 0.605333s / re-run 0.569153s**. Catalog, snapshot, SQL and journal match verified publisher staging; no 0067 or review-only marker. Data: **21,569,823 bytes (20.571 MiB)**. SQL checks UUID/reference preservation, names and Arabic governorates, hierarchy and no-op re-run behavior. Source points: 2,803 exact +1 geometry +1 prior documented coastal correction.

Additional final commands pass: cities unit (19 suites/199 tests), cities Docker integration (3/17), build typecheck, coverage(exit0), SQL verifier, source-point verifier and format checks. Stage commands, test counts and log paths are recorded in `release-gate-status.json`; full raw attempt logs remain under `output/neighbourhood-cities/pr27-*`. Only clean-commit full certification remains. No frontend, host reinstall, commit, push, PR change, deployment or production action.
