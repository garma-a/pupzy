# Baseline (before any audit fix) — 2026-09-24

Recorded on branch `audit/e2e-release-readiness` before any application code was changed.
Only test infrastructure was added at this point (TEST_DATABASE_URL override, R2_ENDPOINT override).

| Check | Result | Notes |
|---|---|---|
| Backend `tsc -p tsconfig.build.json` (shipped code) | **0 errors** | |
| Backend `tsc -p tsconfig.json` (incl. tests) | 149 errors | All in `*.spec.ts` / `test/`; ts-jest still runs them |
| Backend ESLint (excluding `prettier/prettier`) | **0 errors, 0 warnings** | Prettier rule excluded: every file is CRLF on this Windows checkout (`core.autocrlf=true`) |
| Backend unit (`jest`, non-integration) | **1006 / 1028 tests, 72 / 75 suites** | 21 × `EPERM fsync` (Windows can't fsync a directory — `cities/publish`, `cities/refresh`); 1 × decoder-timeout timing test |
| Backend integration (`TEST_DATABASE_URL=…/pupzy_test`) | **558 / 607 tests, 36 / 41 suites** | 45 failures = 4 suites that start their own Docker container (no Docker here); 4 failures = PostgreSQL 18 reports RESTRICT FK violations as `23001` instead of `23503` (tests pin PG16) |
| Frontend `flutter analyze` | **No issues** | |
| Frontend `flutter test` | **56 / 56** | |
| Frontend line coverage | **9.7 %** (897 / 9 293 lines) | `flutter test --coverage` |

Environment differences vs CI: Windows instead of Linux, PostgreSQL 18.4 + PostGIS 3.6.2 instead of
the `postgis/postgis:16-3.4-alpine` test image, no Docker.
