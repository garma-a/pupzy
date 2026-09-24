# Pupzy Audit — Progress

Branch: `audit/e2e-release-readiness` (off `main` @ e5c6162). Resume from the first unchecked item.

Environment (discovered 2026-09-24): Windows 10, Flutter 3.38.9, Android SDK 36 + emulator + AVD `Pixel_7_Pro`,
Java 17, Node 24, local Postgres at localhost:5432 (`pupzy`). **No Docker, no macOS, no psql CLI.**

## Phase 1 — Map the app
- [x] 1.1 Read package.json, pubspec.yaml, env examples, Drizzle schema + migrations, GraphQL schema, Flutter screens
- [x] 1.2 Write AUDIT/inventory.md (screens, flows, PostTypes, GraphQL ops, DB tables)
- [x] 1.3 Commit

## Phase 2 — Get it running
- [x] 2.1 Install deps (backend npm, frontend pub)
- [x] 2.2 Test DB: migrations applied, seed 3+ users (owner / viewer / blocked), posts of every PostType, products, cities
- [x] 2.3 Start backend, confirm GraphQL endpoint responds
- [x] 2.4 Baseline: backend lint/typecheck/unit/integration; frontend analyze + tests — record before changing anything
- [x] 2.5 Commit

## Phase 3 — Backend tests
- [x] 3.1 Determine how existing e2e/integration tests authenticate + reach a DB
- [x] 3.2 Post-type × role e2e (test/live/post-matrix.live-spec.ts: 144 pass, 6 todo) (owner / viewer / logged-out / blocked) for all 5 PostTypes
- [x] 3.3 Auth/IDOR, validation, pagination edges, empty results, duplicates
- [x] 3.4 Upload validation (wrong type, oversize, missing)
- [x] 3.5 Mating: create, feed, city filter, edit (N/A — F-03), delete, ownership
- [x] 3.6 Static checks: N+1, indexes, unhandled rejections, secrets, CORS, rate limiting, depth/complexity, introspection
- [x] 3.7 Commit

## Phase 4 — Frontend tests
- [ ] 4.1 Widget tests for screens/forms (validation, loading, error, empty)
- [x] 4.2 integration_test flows on emulator against local backend (explore, Find a Mate owner/viewer/blocked/delete + GPS, upload stall)
- [ ] 4.3 Checks: null-safety, GraphQL errors, back stack, small-screen overflow, dark mode, offline/slow, image failures
- [ ] 4.4 Commit

## Phase 5 — Use the app like a user
- [ ] 5.1 Drive the running app with screenshots; bad inputs, double taps, rapid nav, kill mid-upload
- [ ] 5.2 Log UX issues with screenshots

## Phase 6 — Post type × owner / viewer / logged-out / blocked
- [x] 6.1 Backend matrix (covered by 3.2)
- [ ] 6.2 Flutter UI matrix
- [x] 6.3 Hang / timeout / retry audit (8 uploads had no timeout → fixed; GraphQL client has 30 s timeout)
- [ ] 6.4 Commit

## Phase 7 — Release readiness
- [ ] 7.1 Android: appbundle + apk release builds
- [ ] 7.2 Android: applicationId, versions, SDK levels, signing, R8/ProGuard, manifest, icons, deep links
- [ ] 7.3 Android: install release APK on emulator and run main flows
- [x] 7.4 iOS: static audit (no macOS) — bundle id, versions, Info.plist, PrivacyInfo, ATS, Podfile, icons, Sign in with Apple
- [ ] 7.5 Both: prod API URL, debug leaks, crash reporting, Firebase config, account deletion, UGC report/block, privacy policy + data inventory, plugin versions
- [ ] 7.6 Commit

## Wrap-up
- [ ] 8.1 Re-run full suites after fixes
- [ ] 8.2 Write AUDIT/REPORT.md
- [ ] 8.3 Re-read this file; every item done or listed as blocked
- [ ] 8.4 Final commit
