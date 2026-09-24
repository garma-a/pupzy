# Pupzy — End-to-End Audit Report

**Branch:** `audit/e2e-release-readiness` (base `main` @ e5c6162) · **Date:** 2026-09-24/25 · **Environment:** Windows 10, Flutter 3.38.9, Android emulator (API 36, x86_64), PostgreSQL 18.4 + PostGIS 3.6.2, Node 24 — no Docker, no macOS.

Supporting files: [`inventory.md`](inventory.md) (system map) · [`baseline.md`](baseline.md) (pre-change results) · [`findings.md`](findings.md) (working log) · [`progress.md`](progress.md) · [`screenshots/`](screenshots/) · [`e2e-rig/`](e2e-rig/) (credential-free test rig).

---

## 1. Summary

Everything was tested against isolated local databases and a **credential-free rig**: the Firebase Auth *Emulator* instead of the real project, `s3rver` instead of Cloudflare R2, throwaway keys. No production data or real credential was used; nothing was uploaded to either store.

**9 defects fixed** (11 counting the three separate layout overflows under F-28) — each in its own commit with a regression test — **20 proposed**, 6 informational. The four most important fixes:

1. **Critical — any signed-in user could read any poster's email address** (plus phone ciphertext, home city, last-seen) through `post { creator { … } }` — including anonymous rescue reporters. Fixed.
2. **High — every city-filtered feed crashed on any database built from the migrations** (`posts.coordinates` had no SRID). The Help tab, Home, Adopt and Market feeds all failed with "mixed SRID". Fixed with migration 0057.
3. **High — post photos were published with their GPS location**: a Find a Mate photo went public still tagged with the exact spot it was taken, although mating/adoption/product posts are designed to show only a city. Fixed in the app; the server still needs its own stripping (F-08).
4. **High — a stalled photo upload froze the post form forever** (still spinning after 90 s; only escape was Back, losing the form). Fixed: 45 s timeout, form recovers for retry.

**Release verdict: Android — Blocked. iOS — Blocked / unverified.** Main blockers: release builds are signed with the debug key; there is no reachable privacy-policy link; the production API URL is not documented; iOS could not be built here (no macOS). See §7.

### Test results, before → after

| Suite | Before | After |
|---|---|---|
| Backend unit (`jest`) | 1006 / 1028 pass (22 env failures) | **1020 / 1042** pass — same 22 env failures ¹ (+14 new tests). The final full run measured 1019: the glossary spec flagged the phrase "deleted Post" in a new test, fixed in 592f9cd and re-run green |
| Backend integration (`TEST_DATABASE_URL`) | 558 / 607 pass (45 Docker-blocked, 4 PG18) | **560 / 609** pass — exactly the same 45 Docker-blocked + 4 PG18 failures as baseline; +2 new tests (SRID regression) pass |
| Backend live e2e (new) | — | **171 / 171** pass, 6 `todo` (the "edit" cell per type — F-03). Post matrix 144 + API edges 27; 3 cells are `it.failing` and document F-08 ×2 and F-09 |
| Backend type-check (shipped code) / lint | 0 / 0 | **0 / 0** |
| Flutter `analyze` | clean | **clean** |
| Flutter tests | 56 / 56 | **89 / 89** |
| Flutter line coverage | 9.7 % | **29.4 %** |
| Flutter on-device integration (new) | — | **5 tests pass** (explore, Find a Mate owner/viewer/blocked/delete, upload stall, API down, API hanging); also pass at 360 dp + 130 % text |

¹ 21 × `EPERM fsync` in the city-catalog release tool (Windows can't fsync a directory; Linux CI unaffected) and 1 timing-sensitive decoder test.

---

## 2. Bugs — ranked

Status: **FIXED** (commit) · **PROPOSED** (documented fix, not applied — risky, architectural, or needs a decision/credential).

### Critical

| ID | Area | Bug | Repro | Where | Status |
|---|---|---|---|---|---|
| F-01 | Backend privacy | Any signed-in user can read any poster's **email**, phone ciphertext, home city, language, notification setting and last-seen by selecting them on `Post.creator` (also comment authors, contact requesters, adoption applicants). Bypasses the contact-request model, which reveals a phone only after approval. | As any user: `{ post(id:"…") { creator { email phoneNumber } } }` → returned `owner@pupzy.test` + ciphertext on every post type | `backend/src/users/users.resolver.ts` (no field guards); `users.graphql:7` | **FIXED** 7076ecb — private fields resolve only for the account itself; unit + live regression tests |

### High

| ID | Area | Bug | Repro | Where | Status |
|---|---|---|---|---|---|
| F-11 | Backend DB | `posts.coordinates` is `geometry(point)` with **no SRID** on any DB built from migrations; API inserts land SRID 0 and every city/location-filtered feed fails "Operation on mixed SRID geometries". Test fixtures inserted `ST_SetSRID(…,4326)` and hid it. | Fresh DB → create a post via API → `helpFeed(cityId:…)` → INTERNAL_SERVER_ERROR | `drizzle/migrations/0001_windy_moondragon.sql:2` | **FIXED** fc1994d — migration 0057 (no-op where already correct); integration test fails without it. **Check production:** `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='posts'::regclass AND attname='coordinates'` — if it is not `geometry(Point,4326)`, prod city feeds are broken today |
| F-19 | App privacy | Post photos uploaded with EXIF intact and published byte-for-byte → **GPS position of where the photo was taken goes public** (image_picker on iOS keeps full metadata by default). | Device test: GPS-tagged photo → Find a Mate → download published photo → `lat=30.0626 lng=31.2197` | `frontend/lib/screens/post_form_screen.dart` (6 upload paths) | **FIXED** 45d3cd6 — `photoForUpload` re-encodes without metadata; device run now `PHOTO_GPS_LEAK=false` |
| F-20 | App hang | All 8 presigned uploads awaited `http.put` with **no timeout** → infinite spinner if the connection stalls. | Device test with storage replaced by a black hole: still spinning at 90 s (`screenshots/stall-before-fix-still-spinning-90s.png`) | `post_form_screen.dart` ×6, `profile_screen.dart`, `comments_sheet.dart` | **FIXED** 5daecb6 — 45 s timeout, form recovers at 42 s (`stall-after-fix-recovered-42s.png`) |
| F-21 | App i18n | Free-text pet age ignores Arabic: Arabic-Indic digits (`٣`) and the form's **own Arabic placeholder** (`سنتان`) were unparseable → Find a Mate submit stayed disabled; Adoption silently dropped the age; `6 شهور` (6 months) published as **6 years**; `18mo` as 18 years. | Type `سنتان` in Find a Mate → button stays disabled | `post_form_screen.dart` `_parseAge` | **FIXED** 01d1616 — `lib/utils/age_parser.dart` + 10 tests; device run shows "2 years" |
| F-27 | App / store | Profile sheet was a fixed Column: **Sign Out and Delete Account clipped** on small screens (33 px at 360×780 dp; more with large text). In-app account deletion is a store requirement. | Device at 360 dp → open profile | `profile_screen.dart:312` | **FIXED** b433cb0 — sheet scrolls |
| F-08 | Backend uploads | Post media is copied to public storage **without inspecting the bytes**: a text file or PNG declared `image/jpeg` is published; no server-side EXIF strip (comment images, by contrast, are fully validated). Arbitrary-file hosting on the CDN; GPS leaks from any client that doesn't strip. | `api-edges.live-spec.ts` (2 × `it.failing`) | `backend/src/upload/upload.service.ts` finalize path | **PROPOSED** — decode with `sharp` at finalize, reject non-images, re-encode to strip metadata (same pipeline as comment images) |
| F-10 | Backend availability | All rate limits key on **client IP only** (throttler runs before auth): global 100 req/min, `createMatingPost` 5/h, `requestContact` 5/min, `submitAdoptionApplication` 10/h. Users behind carrier CGNAT share one bucket; reproduced from the real app (429 on the 6th Find a Mate post in an hour from one IP). | Live probe + device run; backend log `429 RATE_LIMITED … user-agent Dart/3.10` | `common/guards/gql-throttler.guard.ts` (no `getTracker`) | **PROPOSED** — authenticate first, then track by user id (`getTracker` returning `user:<id>`), keep a generous IP limit for anonymous calls |
| F-03 | Product | **No edit operation for any post type.** Owners must delete and re-create, losing comments, saves, raises and requests. | 74-op inventory | `posts.graphql`, `mating.graphql` | **PROPOSED** — `updateXPost` mutations + edit forms (product decision) |
| F-30 | Store compliance | Login says "you agree to our Terms of Service and Privacy Policy" as **plain, untappable text**; no privacy-policy link anywhere; the only legal link appears after sign-in and only if the backend sets `TERMS_URL`. | `screenshots/release-01-launch.png` | `login_screen.dart:612` | **PROPOSED** — needs the real policy URLs; make both tappable on login and in Profile → Terms & Privacy |

### Medium

| ID | Area | Bug | Where | Status |
|---|---|---|---|---|
| F-02 | Backend config | `ACCOUNT_DELETION_ENABLED=false` parsed as **true** (`z.coerce.boolean`) — kill-switch unusable | `config/env.config.ts:70` | **FIXED** 7b0d3e3 (+11 tests) |
| F-28 | App layout | At 360 dp + 130 % text: rescue/lost detail action row overflowed 37 px (save button off-screen); "+" sheet overflowed 27 px (List a Product cut off); Home carousels clipped 7 px | `rescue_detail_screen.dart:328`, `new_post_sheet.dart:63`, `home_screen.dart:519,553` | **FIXED** 706bbb2 |
| F-09 | Backend privacy | Photos of **owner-removed posts stay publicly downloadable** indefinitely — OWNER_REMOVE retains media by contract, no deletion work enqueued | `post-matrix.live-spec.ts` `it.failing` (polled 120 s, HTTP 200) | **PROPOSED** — enqueue media deletion on OWNER_REMOVE (keep retention for ADMIN_REMOVE, which can be restored) |
| F-22 | App UX | Server error messages shown verbatim: "ThrottlerException: Too Many Requests", "hasMedicalNeeds: hasMedicalNeeds is required for LOST_PET reports" — technical, English-only | `graphql_service.dart` `_serverErrorMessage` | **PROPOSED** — map `extensions.code` → localized copy |
| F-16 | Backend perf | Radius feeds gather and sort every post within 25 km to return 20 (see §6) | `posts.repository.ts` feed queries | **PROPOSED** |
| F-26 | Release | **No crash reporting** — `_reportError` only `debugPrint`s | `main.dart` | **PROPOSED** — Firebase Crashlytics |
| F-32 | iOS | `PrivacyInfo.xcprivacy` declares **no collected data types** although the app collects email, name, phone, location, photos, user content, push token | `ios/Runner/PrivacyInfo.xcprivacy` | **PROPOSED** — list per §7.3 |
| F-35 | Release | `google_sign_in` 6.x uses the legacy Android Google Sign-In API that Google has deprecated in favour of Credential Manager | `pubspec.yaml` | **PROPOSED** — upgrade to 7.x |

### Low / Info

| ID | Sev | Bug | Status |
|---|---|---|---|
| F-29 | Low | Android launcher label was lowercase "pupzy" (iOS: "Pupzy") | **FIXED** 8e5a68a |
| F-06 | Low | Owner viewing *their own* post's `creator.phoneNumber` gets ciphertext (loader rows not decrypted); app never reads it | PROPOSED |
| F-07 | Low | `lib/firebase_options.dart` is an unused duplicate of `lib/config/firebase_options.dart` | PROPOSED — delete |
| F-12 | Low | Out-of-range `first` rejected by post feeds but clamped by `matingFeed` | PROPOSED — pick one |
| F-13 | Low | Backend still accepts `requestContact` on RESCUE (product decision: no contact) and ADOPTION (parallel to applications) | PROPOSED |
| F-15 | Low | `Post.nearestVetClinics` runs one geo query per post (no DataLoader) — fine on detail, amplifiable in a 50-post feed | PROPOSED |
| F-17 | Low | No `unhandledRejection` handler; idempotency interceptor cache writes lack `.catch` | PROPOSED |
| F-23 | Low | Top-bar avatar shows "?" for email accounts (uses Firebase `displayName`, not the profile name) | PROPOSED |
| F-24 | Low | "Complete all required fields to post" stays visible above an enabled submit button | PROPOSED |
| F-36 | Low | With the API unreachable, sign-in spins 20–35 s before "Could not reach the server" | PROPOSED — shorter connect timeout |
| F-37 | Low | `google_fonts` fetches fonts from Google at runtime (IP disclosure; fallback font offline) | PROPOSED — bundle fonts, `allowRuntimeFetching = false` |
| F-04 | Info | City catalog tooling fsyncs a directory (EPERM on Windows) | INFO |
| F-05 | Info | Tests pin PG16 FK error codes; PG18 reports RESTRICT as 23001 | INFO |
| F-14 | Info | Development mode returns raw SQL in errors (production masks) | INFO |
| F-18 | Info | Token/user/idempotency caches are in-memory per instance | INFO |
| F-25 | Info | One background request fires after sign-out → 401 noise | INFO |
| F-34 | Info | App ships a light theme only; ignores system dark mode (renders correctly) | INFO |

Test-infrastructure changes (not app behaviour): `TEST_DATABASE_URL` for integration suites without Docker (3934ba4), optional `R2_ENDPOINT` for S3 fakes (1d63660), debug-only `AUTH_EMULATOR_HOST` hook + debug-only cleartext (4f383e9).

---

## 3. Post matrix — post type × action × role

Sources: backend `test/live/post-matrix.live-spec.ts` (HTTP, real tokens and uploads), `api-edges.live-spec.ts`, Flutter `test/post_detail_roles_test.dart` (UI controls per role), `integration_test/mating_flow_test.dart` (device). **Logged-out** = no token: every read and write returns `UNAUTHENTICATED` (only cities, vets and account-deletion progress are public). **Blocked** = an account the owner blocked.

| Action · role | RESCUE | LOST_PET | FOUND_STRAY | ADOPTION | PRODUCT | MATING |
|---|---|---|---|---|---|---|
| **Owner** create — all fields, 1 photo | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Owner create — required fields only | PASS | PASS | PASS | PASS | PASS | PASS |
| Owner create — 4 photos ok, 5th rejected | PASS | PASS | PASS | PASS | PASS | PASS |
| Owner create — no photo | PASS (allowed) | PASS (allowed) | PASS (allowed) | PASS (allowed) | PASS (allowed) | PASS (rejected, required) |
| Owner sees it in My Posts | PASS | PASS | PASS | PASS | PASS | PASS |
| Owner sees it in its feed, city-scoped | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Owner detail + owner-only controls (UI) | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Owner edits | N/A — [F-03] | N/A | N/A | N/A | N/A | N/A |
| Owner closes (type outcome) → leaves feed, stays readable | PASS RESOLVED | PASS REUNITED | PASS RESOLVED | PASS ADOPTED | PASS SOLD | PASS RESOLVED |
| Owner renews | N/A (rejected ✓) | N/A | N/A | PASS | PASS | N/A |
| Owner sees requests / applications on own post | — (comments) | PASS | PASS | PASS | — (direct contact) | PASS |
| Owner deletes → gone from feeds, My Posts, Saved, detail | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Deleted post's photos unreachable | **FAIL** [F-09] | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| **Viewer** sees it in feed with owner name + photos | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Viewer cannot read owner's private fields | PASS [F-01 fixed] | PASS | PASS | PASS | PASS | PASS |
| Exact location | shown (by design) | shown | shown | hidden ✓ | hidden ✓ | hidden ✓ |
| Photo GPS metadata stripped | PASS [F-19 fixed, app side] | PASS | PASS | PASS | PASS | PASS (device-verified) |
| Viewer detail, no owner controls (UI) | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Viewer upvote / un-upvote | PASS | PASS | PASS | PASS | N/A (rejected ✓) | PASS |
| Viewer save → in Saved | PASS | PASS | PASS | PASS | PASS | PASS |
| Viewer comment (+ idempotent retry) | PASS | PASS | PASS | PASS | PASS | PASS |
| Viewer reaches owner | Directions + Post Update (UI) | PASS request → approve → WhatsApp | PASS | PASS apply → approve → WhatsApp | PASS direct seller link | PASS (+ device) |
| Viewer report (dup → already reported) | PASS | PASS | PASS | PASS | PASS | PASS |
| Viewer block owner (UI menu present) | PASS | PASS | PASS | PASS | PASS | PASS |
| Viewer **cannot** close / delete / renew / list requests (API) | PASS FORBIDDEN | PASS | PASS | PASS | PASS | PASS |
| **Logged-out** read / act | PASS UNAUTHENTICATED | PASS | PASS | PASS | PASS | PASS |
| **Blocked** — not in feed / by id / detail | PASS | PASS | PASS | PASS | PASS | PASS (+ device) |
| Blocked — cannot save / comment / contact | PASS NOT_FOUND | PASS | PASS | PASS | PASS | PASS |
| Blocked — hidden in reverse direction | PASS | PASS | PASS | PASS | PASS | PASS |
| Stale link to deleted post → clean "not found" | PASS | PASS | PASS | PASS | PASS | PASS |
| No infinite spinner on upload stall | PASS [F-20 fixed] | PASS | PASS | PASS | PASS | PASS (device-verified) |

---

## 4. Security findings

| Check | Result |
|---|---|
| Authorization / IDOR | ✅ Owner-only mutations and lists return FORBIDDEN to other users (close, delete, renew, request/application lists); third parties can't fetch others' WhatsApp links; requesters can't approve their own requests; blocked pairs get neutral NOT_FOUND. ❌ **F-01** (PII over `User` type) — **fixed**. |
| Authentication | ✅ Missing/malformed token → UNAUTHENTICATED; unverified email rejected; Terms gate enforced on publish (`TERMS_ACCEPTANCE_REQUIRED`). |
| Upload validation | ✅ Type allow-list (JPEG/PNG/WebP), size bounds, ownership, single use, never-uploaded tickets. ❌ **F-08** content not inspected. |
| Secrets | ✅ No secrets tracked in git (`.env*`, keystores, `key.properties` ignored); none hard-coded in the app; no tokens logged; no raw `print`. |
| CORS / headers | ✅ Allow-list from `ALLOWED_ORIGINS`; Helmet; `trust proxy 1`. |
| Rate limiting | ⚠️ Present and GraphQL-aware, but **IP-keyed only** (**F-10**). |
| GraphQL hardening | ✅ Introspection and playground off in production; depth limit 10; page size clamped/validated (max 50). ⚠️ No cost/complexity limit — combined with F-15 a client can request per-post geo lookups across a feed. |
| Error disclosure | ✅ Production masks unexpected errors. ℹ️ Development returns SQL (F-14). |
| Privacy | ❌ F-19 (GPS in photos) **fixed app-side**; F-08, F-09 open. |

---

## 5. Frontend / UX findings (screenshots in `screenshots/`)

| Finding | Evidence | Status |
|---|---|---|
| Stalled upload froze the form | `stall-before-fix-still-spinning-90s.png` → `stall-after-fix-recovered-42s.png` | FIXED |
| Arabic age unusable in Find a Mate | `mate-03-filled-form.png` (enabled with `سنتان`), `mate-06-viewer-detail.png` ("2 years") | FIXED |
| Delete Account / Sign Out clipped on small screens; three more overflows at large text | device logs at 360 dp / 130 % | FIXED |
| API down / hanging → recovers to login with a clear toast in ≤ 35 s | `backend-down-*.png`, `backend-hanging-*.png` | PASS (F-36 slow) |
| Raw server errors shown to users | reproduced (429) | PROPOSED F-22 |
| Avatar shows "?" for email accounts | `explore-*.png` top-right | PROPOSED F-23 |
| Legal text not tappable | `release-01-launch.png` | PROPOSED F-30 |
| Rescue photos blurred behind "Tap to see photo" | `explore-02-help.png` | by design ✓ |
| Location permission | App requests on first use (native dialog); feeds work with it granted. The on-device suite now grants it from the host so the dialog doesn't cover runs. | ✓ |
| Double submit | Submit disabled while `_submitting`; confirmed during the stall test | ✓ |

---

## 6. Performance findings

Measured with `EXPLAIN (ANALYZE, BUFFERS)` on the real repository SQL against **200,029 posts** across 351 cities (`pupzy_perf`):

| Feed (Qasr Al-Nile, 25 km, 20 rows) | Median end-to-end | DB execution | Plan |
|---|---|---|---|
| matingFeed (city) | 2.1 ms | 0.2 ms | `idx_posts_city_type` + `mating_posts_pkey` ✅ |
| matingFeed (all) | 1.9 ms | 0.1 ms | `idx_posts_mating_active_created` ✅ |
| adoptFeed / marketFeed | 63–87 ms | ~61 ms | BitmapAnd(`idx_posts_last_engaged`, `idx_posts_coordinates`) → sort |
| homeFeed | 105 ms | 98 ms | BitmapAnd(coordinates, active creator) → sort |
| helpFeed | 82 ms | **177 ms** | BitmapAnd → sort all in radius |
| helpFeed + search | 94 ms | 94 ms | trigram index ✅ |

- **No missing indexes** on filtered/sorted columns (feeds, blocks, contact requests, comments, notifications, saves, upvotes all indexed).
- **No N+1 in feeds**: creator, city, media, upvote/save state and comment counts all go through per-request DataLoaders. Exception: `nearestVetClinics` (F-15).
- **F-16**: radius feeds sort every candidate within 25 km; cost grows linearly with density. Options: distance-bucketed keyset pagination, or pre-filter by the city list inside the radius.

---

## 7. Release readiness

### 7.1 Android — **BLOCKED**

`flutter build appbundle --release` ✅ (58.1 MB) · `flutter build apk --release` ✅ (69.8 MB) · release APK installs and launches on the emulator in ~3 s with no crash, no missing plugin, no R8 class errors; login screen and local validation work (`release-01-launch.png`, `release-02-empty-signin-validation.png`).

| Check | Result |
|---|---|
| applicationId | ✅ `com.pupzy.app` (matches `google-services.json`) |
| versionCode / versionName | ✅ `1` / `1.0.0` from `pubspec.yaml` `version: 1.0.0+1` — bump `+N` per upload |
| targetSdk / minSdk / compileSdk | ✅ 36 / 24 / 36 (Play requires ≥ 35) |
| **Release signing** | ❌ **signed with the debug key** (`build.gradle.kts:39`, `CN=Android Debug`) — Play rejects. `key.properties` / `*.jks` are already gitignored |
| R8 / shrinking | ✅ enabled (21 MB mapping). Dart code is AOT so GraphQL/JSON models aren't affected; release APK starts cleanly |
| Permissions | ✅ Fine/coarse location, POST_NOTIFICATIONS, plus INTERNET / network state / FCM from plugins. No camera or storage permissions (gallery via the system photo picker) |
| Runtime permission requests | ✅ location (geolocator), notifications (FCM) |
| Exported components | ✅ launcher activity + Firebase Auth / FCM / profile-installer components only |
| Cleartext | ✅ none in release (the audit's cleartext setting is debug-only) |
| Icon / splash / name | ✅ adaptive icon, native splash incl. night; label fixed to "Pupzy" (F-29) |
| Deep links / App Links | none used |
| Production API URL | ❌ not documented; release **requires** `--dart-define=GRAPHQL_ENDPOINT` or the app throws at startup |
| Store-rejection risks | debug signing; no privacy-policy link (F-30); Data Safety form must match §7.3; deprecated Google Sign-In (F-35); no crash reporting (F-26) |

**Produce a signed release:**

```bash
keytool -genkey -v -keystore %USERPROFILE%\pupzy-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`frontend/android/key.properties` (gitignored):

```properties
storePassword=<…>
keyPassword=<…>
keyAlias=upload
storeFile=C:\\Users\\<you>\\pupzy-upload.jks
```

In `frontend/android/app/build.gradle.kts`, load it and replace the debug signing:

```kotlin
import java.util.Properties
val keyProps = Properties().apply { rootProject.file("key.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
android {
    signingConfigs {
        create("release") {
            keyAlias = keyProps["keyAlias"] as String
            keyPassword = keyProps["keyPassword"] as String
            storeFile = file(keyProps["storeFile"] as String)
            storePassword = keyProps["storePassword"] as String
        }
    }
    buildTypes { release { signingConfig = signingConfigs.getByName("release") } }
}
```

```bash
flutter build appbundle --release --build-number=<N> --dart-define=GRAPHQL_ENDPOINT=https://<production-api>/graphql --obfuscate --split-debug-info=build/symbols
```

### 7.2 iOS — **BLOCKED (unverified: no macOS)**

`flutter build ios --release --no-codesign` and `flutter build ipa` **could not run** (Windows). Static audit of `frontend/ios`:

| Check | Result |
|---|---|
| Bundle identifier | ✅ `com.pupzy.app` (matches `GoogleService-Info.plist`) |
| Version / build | ✅ 1.0.0 (1) from pubspec |
| Deployment target | ✅ iOS 13.0 (Firebase minimum) |
| Usage descriptions | ✅ Location When In Use, Camera, Photo Library. (Photo-library *add* not needed — the app never saves photos.) |
| PrivacyInfo.xcprivacy | ⚠️ present with required-reason APIs (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1); **`NSPrivacyCollectedDataTypes` empty** (F-32) |
| ATS | ✅ no `NSAllowsArbitraryLoads` |
| Encryption export | ✅ `ITSAppUsesNonExemptEncryption = false` |
| Sign in with Apple | ✅ entitlement present (required, since Google sign-in exists) |
| Push | ✅ `aps-environment` present (`development` in the file; export sets production) |
| Icons / launch screen | ✅ 25 sizes incl. 1024 marketing, no alpha; `LaunchScreen.storyboard` |
| Google Sign-In URL scheme | ✅ matches `REVERSED_CLIENT_ID` |
| Podfile / pods | ⚠️ not committed (generated on macOS); `pod install` unverified |
| Signing team | ⚠️ `DEVELOPMENT_TEAM` not set |
| Store-rejection risks | no privacy-policy link (F-30); privacy manifest data types (F-32); App Store privacy labels must match §7.3 |

On a Mac:

```bash
cd frontend && flutter build ipa --release --build-number=<N> --dart-define=GRAPHQL_ENDPOINT=https://<production-api>/graphql
```

### 7.3 Both platforms — data collected (for Play Data Safety / Apple privacy labels)

| Data | Source in code | Purpose | Shared with other users? |
|---|---|---|---|
| Name (EN/AR) | `completeProfile` / `updateProfile` | Account, shown on posts | Yes (display name) |
| Email | Firebase Auth, `users.email` | Account | No (after F-01 fix) |
| Phone number | `completeProfile` (encrypted at rest) | Contact handoff | Yes — only to approved requesters/applicants via WhatsApp link, and to buyers on product listings |
| Precise location | device GPS; rescue/lost post coordinates; `updateMyLocation` | Nearby feeds, rescue location | Yes — exact point on rescue/lost posts |
| Approximate location | home city, post city | Feed scoping | Yes (city on posts) |
| Photos | post, comment and profile photos | App functionality | Yes (public) |
| User content | posts, comments, contact messages, adoption answers (living situation, children, other pets…) | App functionality | Posts/comments public; messages/answers to the post owner |
| App activity | views, raises, saves, searches, reports, blocks, Terms acceptance | Ranking, safety | No |
| Device ID | FCM token + platform | Push notifications | No |
| Diagnostics | none (no crash reporting — F-26) | — | — |

Processors: Firebase (Auth, Messaging), Cloudflare R2, Google Fonts at runtime (F-37). Account deletion: in-app ✅ (Profile → Delete Account; now reachable on small screens). Report + block on posts, comments and accounts: ✅ (Apple 1.2 / Google UGC).

### 7.4 Both platforms — other checks

| Check | Result |
|---|---|
| Release API URL | ✅ release builds refuse to start without `--dart-define=GRAPHQL_ENDPOINT` — no localhost/10.0.2.2 in release. ❌ The URL itself isn't documented |
| Debug banner / debug prints / test accounts | ✅ none in release |
| Firebase config files | ✅ present, project `pupzy-app-5f707`, IDs match both platforms |
| Plugin versions | Flutter 3.38.9, AGP 8.11.1, Kotlin 2.2.20, Gradle 8.14. 75 packages have newer majors; notable: `google_sign_in` 6 → 7 (F-35), `cached_network_image` 3 → 4, Firebase plugins one major behind — no blocking incompatibility observed in the release build |

---

## 8. Blocked items

| Item | Error | Tried |
|---|---|---|
| 4 backend integration suites (45 tests) that start their own Testcontainers Postgres | `Could not find a working container runtime strategy` | No Docker on this machine. Added `TEST_DATABASE_URL`, which unblocked the 37 suites using the shared helper; these 4 construct containers directly (cities release/reconcile, migrate, reset) |
| 4 admin-schema integration tests | PG18 returns `23001` for RESTRICT FK violations (tests expect PG16's `23503`) | Environment only; no production code depends on the code |
| 22 backend unit tests | 21 × `EPERM fsync` (Windows) + 1 timing-sensitive test | Linux CI unaffected |
| iOS build / run | not possible on Windows | Static audit instead (§7.2) |
| Release-mode sign-in and flows | Release correctly blocks cleartext, and the Auth-Emulator hook is debug-only; signing in would hit the real Firebase project | Verified release launch, plugins, R8 and local validation instead |
| Real Google / Apple sign-in | needs real accounts | Email/password via Auth Emulator |
| End-to-end push delivery | e2e backend uses a throwaway Firebase key by design | Push code paths covered by existing backend tests |
| Emulator storage | `Pixel_7_Pro` AVD was 91 % full (`INSTALL_FAILED_INSUFFICIENT_STORAGE`) | Created a dedicated `pupzy_e2e` AVD (12 GB); your AVD untouched |

## 9. Untested areas

- **Admin service (AdminJS)** — out of scope.
- **Creating non-Mating post types through the UI on a device** — covered by the API matrix plus widget tests for form validation and owner/viewer controls, but only Find a Mate was driven end-to-end on the device.
- **Comment photo upload on device** — covered by the backend's comment-image integration suites.
- **Full Arabic / RTL visual pass** — Arabic input verified; RTL layout not screenshot-audited.
- **iOS runtime** — no macOS.
- **Account deletion end-to-end on device** — backend integration suite covers it; UI reachability verified.
- **Offline mid-session** beyond sign-in and upload stalls; process kill mid-upload.
- **Per-screen loading / empty / error states** — widget tests cover form validation and owner/viewer controls; feed screens' error handling was checked only through the device API-down/hanging runs.
- **Rapid navigation and killing the app mid-upload** — not tested; a stalled upload was (F-20).
- **Deep links** — none exist.

## 10. Re-run everything

```bash
# 1. Databases (local Postgres with PostGIS): pupzy_test, pupzy_e2e — see AUDIT/progress.md
# 2. Credential-free rig
cd AUDIT/e2e-rig && npm install && node make-e2e-env.js postgresql://<user>:<pass>@localhost:5432/pupzy_e2e
cd ../../backend && npm run build
#    DATABASE_URL=<pupzy_e2e url> npm run db:migrate && npm run db:seed
#    start (separate terminals or .claude/launch.json): node AUDIT/e2e-rig/run.js s3 | auth | backend
cd ../AUDIT/e2e-rig && node seed-e2e.js

# 3. Backend
cd backend
npx tsc --noEmit -p tsconfig.build.json
npx eslint "src/**/*.ts" "test/live/**/*.ts" --rule "prettier/prettier: off"
npm run test:unit
TEST_DATABASE_URL=postgresql://…/pupzy_test npm run test:integration
npm run test:live

# 4. Frontend
cd frontend && flutter analyze && flutter test --coverage
adb reverse tcp:4568 tcp:4568
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/mating_flow_test.dart --dart-define=AUTH_EMULATOR_HOST=10.0.2.2:9099
#    also: explore_test, upload_stall_test (storage → blackhole.js), backend_down_test (--dart-define=BACKEND_MODE=down|hanging)

# 5. Release builds
flutter build appbundle --release --dart-define=GRAPHQL_ENDPOINT=https://<production-api>/graphql
flutter build apk --release --dart-define=GRAPHQL_ENDPOINT=https://<production-api>/graphql
```

The dev backend regenerates `backend/src/graphql.ts` on boot in a Windows-specific order; `AUDIT/e2e-rig/restore-graphql-ts.sh` restores the committed file.
