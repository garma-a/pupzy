# Pupzy — System Inventory

Generated in Phase 1 from the source at `audit/e2e-release-readiness` (base `main` @ e5c6162).
Every count below was produced by a script over the code, not estimated.

## 1. Stack

| Layer | Technology |
|---|---|
| Mobile app | Flutter 3.38.9 (Dart 3), `provider`, `graphql_flutter`, Firebase Auth (Google, Sign in with Apple, email/password), FCM |
| API | NestJS 11 + Apollo Server 5 (schema-first GraphQL), Drizzle ORM 0.45, `pg` |
| Database | PostgreSQL + PostGIS, `uuidv7()` keys, 59 applied migrations + repeatable `drizzle/custom.sql` |
| Storage | Cloudflare R2 via presigned PUT (S3 API); client encodes static WebP ≤ 100 KB, ≤ 480×480 |
| Admin | Separate `admin-service` (AdminJS) — out of scope for this audit |
| Auth | Firebase ID token verified per request by global `FirebaseAuthGuard`; then `TermsAcceptanceGuard` |

Global guard order (`src/app.module.ts:70`): `ThrottlerGuard` → `FirebaseAuthGuard` → `TermsAcceptanceGuard`.

### Backend env (`.env.example`)
`PORT NODE_ENV PHONE_ENCRYPTION_KEY DATABASE_URL DB_POOL_MAX DB_IDLE_TIMEOUT_MS DB_CONNECTION_TIMEOUT_MS FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY FIREBASE_WEB_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_URL ALLOWED_ORIGINS THROTTLE_LIMIT THROTTLE_TTL_MS`

### Frontend config
- API URL: `lib/config/api_config.dart` — debug defaults `http://10.0.2.2:8080/graphql` (Android) / `http://localhost:8080/graphql` (web); release **requires** `--dart-define=GRAPHQL_ENDPOINT=…` or throws at startup.
- Firebase: the app imports `lib/config/firebase_options.dart` (`main.dart:10`, `push_service.dart:8`); `lib/firebase_options.dart` is an unreferenced older copy.

## 2. Post types and lifecycle

| PostType | Sub-type | Extension table | Detail query | Owner close → | Renewable | Photo comments |
|---|---|---|---|---|---|---|
| `RESCUE` | — | `rescue_posts` | `rescuePostDetail` | `RESOLVED` | no | yes |
| `LOST` | `LOST_PET` | `lost_posts` | `lostPostDetail` | `REUNITED` | no | yes |
| `LOST` | `FOUND_STRAY` | `lost_posts` | `lostPostDetail` | `RESOLVED` or `REUNITED` | no | yes |
| `ADOPTION` | — | `adoption_posts` | `adoptionPostDetail` | `ADOPTED` | yes | no |
| `PRODUCT` | — | `product_posts` | `productPostDetail` | `SOLD` | yes | no |
| `MATING` | — | `mating_posts` | `matingPostDetail` | `RESOLVED` | no | no |

Statuses: `ACTIVE RESOLVED REUNITED ADOPTED SOLD REMOVED EXPIRED`. Source of truth: `src/common/contracts/post-lifecycle.contract.ts:90`.

**There is no edit/update operation for any post type.** Owners can only create, close (`updatePostStatus`), renew (`renewPost`, ADOPTION/PRODUCT) and delete (`deletePost`). There is also **no standalone "pet" entity** — pet attributes live in each post type's extension table, so "create pet" in the audit brief maps to "create a post".

Coordinate privacy: RESCUE/LOST return exact coordinates; ADOPTION/PRODUCT/MATING return city only (MATING stores the city centroid, `mating-posts.schema.ts:13`).

## 3. GraphQL surface — 30 queries, 44 mutations, 0 subscriptions

All 74 operations are called by the Flutter app (`lib/services/graphql_service.dart`).
**Anonymous-allowed** (`@Public()`): `cities`, `nearbyVetClinics`, `accountDeletionProgress`, plus REST `GET /health`. **Everything else requires a Firebase token** — logged-out users cannot read any feed or post.

| Domain | Queries | Mutations |
|---|---|---|
| Posts (`posts/posts.graphql`) | `post`, `rescuePostDetail`, `lostPostDetail`, `adoptionPostDetail`, `productPostDetail`, `helpFeed`, `adoptFeed`, `marketFeed`, `homeFeed`, `mySavedPosts`, `myPosts` | `createRescuePost`, `createLostPost`, `createAdoptionPost`, `createProductPost`, `deletePost`, `toggleUpvote`, `toggleSave`, `updatePostStatus`, `renewPost`, `recordView`, `reportPost` |
| Mating (`mating/mating.graphql`) | `matingFeed`, `matingPostDetail` | `createMatingPost` |
| Comments | `comments`, `replies` | `requestCommentImageUploadUrl`, `createComment`, `createReply`, `deleteComment`, `toggleCommentBoost`, `pinComment`, `unpinComment`, `reportComment` |
| Contacts | `myContactRequests`, `postContactRequests`, `getWhatsAppLink`, `getProductSellerContact` | `requestContact`, `approveContactRequest`, `rejectContactRequest` |
| Adoptions | `myAdoptionApplications`, `postAdoptionApplications`, `getAdoptionWhatsAppLink` | `submitAdoptionApplication`, `approveAdoptionApplication`, `rejectAdoptionApplication` |
| Safety | `blockedUsers` | `blockUser`, `unblockUser`, `reportUser` |
| Notifications | `myNotifications`, `myUnreadNotificationCount` | `markNotificationRead`, `markAllNotificationsRead`, `registerDevice`, `unregisterDevice` |
| Users | `me`, `accountDeletionProgress`* | `completeProfile`, `updateProfile`, `updateMyLocation`, `setProfilePhoto`, `removeProfilePhoto`, `updateMyLanguagePreference`, `updateMyNotificationPreferences`, `deleteMyAccount` |
| Upload | — | `requestMediaUploadUrl`, `requestProfilePhotoUploadUrl` |
| Terms | `terms` | `acceptTerms` |
| Reference | `cities`*, `nearbyVetClinics`* | — |

\* public

## 4. Database — 38 tables

`account_deletions account_reports address_search_cache admin_users adoption_applications adoption_posts blocked_media_hashes blocks cities city_catalog_revisions comment_boosts comment_idempotency comment_media comment_quota_admissions comment_reports comments contact_requests device_registrations discussion_notification_events lost_posts mating_posts media_deletion_work media_finalizations moderation_actions notifications post_media post_pins post_reports post_saves post_upvotes posts product_posts push_deliveries rescue_posts staged_uploads users vet_clinic_location_audits vet_clinics`

Triggers: `trg_users_updated_at`, `trg_posts_updated_at`, `trg_sync_user_post_counts`, `trg_post_report_count`, `trg_revoke_admin_sessions`, `trg_audit_append_only`, `trg_prevent_banned_creator_active_post`.

## 5. Flutter — 25 screens, 24 widgets

| Screen | Purpose |
|---|---|
| `splash_screen` | Boot, auth state routing |
| `login_screen` | Google, Apple and email/password sign-in / sign-up |
| `complete_profile_screen` | Name, phone, city, language (required before app use) |
| `app_shell` | Bottom nav: Home / Help / + / Adopt / Market; boots push, terms gate, language sync |
| `home_screen` | Mixed feed, server search, urgent banner, vets sheet |
| `help_screen` | RESCUE + LOST feed with urgency |
| `adopt_screen` | Tabs: Adoption feed + **Mating feed** (`_MatingFeedCard`) |
| `market_screen` | PRODUCT feed by category |
| `new_post_sheet` | + sheet: Rescue, Lost, Found a Pet, Adoption, Product, **Find a Mate** |
| `post_form_screen` | One screen, per-type forms (2 544 lines) |
| `rescue_detail_screen` | RESCUE + LOST (incl. FOUND_STRAY) detail |
| `adoption_detail_screen` | ADOPTION detail + applications |
| `product_detail_screen` | PRODUCT detail + seller contact |
| `mating_detail_screen` | MATING detail + contact request |
| `my_posts_screen` | Own posts by type/status |
| `saved_posts_screen` | Saved posts |
| `contact_requests_screen` | Requests I sent |
| `my_adoption_applications_screen` | Applications I sent |
| `notifications_panel` | Inbox, mark read / all read |
| `profile_screen` (`ProfileSheet`) | Profile, avatar, language, notifications, terms, links to above |
| `blocked_accounts_screen` | Unblock |
| `delete_account_screen` / `account_deletion_in_progress_screen` | Store-required account deletion |
| `account_suspended_screen` | Banned users |
| `vets_screen` | Nearby vet clinics |

Key widgets: `city_picker_sheet` (Find-a-Mate + browse location), `comments_sheet`, `contact_request_sheet`, `adoption_application_sheet`, `owner_post_actions` (close/delete), `renew_post_button`, `report_sheet` / `safety_actions` (report + block), `image_with_fallback`.

Navigation: imperative `Navigator.push` with a `rootNavigatorKey` (`lib/utils/navigation.dart`); no named routes, **no deep links**.

## 6. User flows

1. **Onboarding** — install → splash → login (Google or email) → email verification (backend rejects unverified: `EMAIL_NOT_VERIFIED`) → complete profile → terms gate → shell.
2. **Browse** — Home / Help / Adopt (Adoption + Mating tabs) / Market, all scoped to the browse city (top-bar pill) with server-side search.
3. **Create** — + sheet → type form → photos (1–4, direct R2 upload) → submit. Per type: Rescue, Lost Pet, Found a Pet (FOUND_STRAY), Adoption, Product, Find a Mate.
4. **Owner manage** — detail → Close (type-specific outcome) / Delete / Renew (ADOPTION, PRODUCT); review contact requests / adoption applications; pin comments.
5. **Viewer engage** — raise (upvote), save, comment (+photos on RESCUE/LOST), request contact (LOST/MATING), apply (ADOPTION), seller contact (PRODUCT), directions + post update (RESCUE).
6. **Contact handoff** — request → owner approves → requester fetches WhatsApp link on demand.
7. **Safety** — report post / comment / account; block account (hides both directions); unblock.
8. **Account** — avatar, language, notification toggle, terms, my posts, saved, requests, applications, delete account, sign out.
