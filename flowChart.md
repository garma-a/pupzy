# Pubzy — Complete System Flowcharts

> Every section of the platform, diagrammed end-to-end.
> Each flow maps to specific DB tables, GraphQL operations, and the implementation phase it belongs to.

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph Client ["Flutter Mobile App"]
        UI["UI Layer (Riverpod)"]
        GQL_CLIENT["GraphQL Client"]
        FB_SDK["Firebase Auth SDK"]
        GPS["Geolocator"]
        CAM["Camera / Image Picker"]
    end

    subgraph Backend ["NestJS Backend"]
        GUARD["FirebaseAuthGuard"]
        GQL_API["GraphQL API (Apollo 5)"]
        
        subgraph Resolvers ["Resolvers"]
            R_USER["UsersResolver"]
            R_POST["PostsResolver"]
            R_FEED["FeedResolver"]
            R_CONTACT["ContactResolver"]
            R_ADOPT["AdoptionAppResolver"]
            R_NOTIF["NotificationResolver"]
            R_MEDIA["MediaResolver"]
            R_ADMIN["AdminResolver"]
        end
        
        subgraph Services ["Services"]
            S_USER["UsersService"]
            S_POST["PostsService"]
            S_FEED["FeedService"]
            S_CONTACT["ContactService"]
            S_ADOPT["AdoptionAppService"]
            S_NOTIF["NotificationService"]
            S_MEDIA["MediaService"]
            S_MOD["ModerationService"]
            S_RANK["RankingService"]
        end
        
        subgraph Data ["Data Layer"]
            DRIZZLE["Drizzle ORM"]
            CRYPTO["CryptoUtil (AES-256)"]
        end
    end

    subgraph Infrastructure ["Infrastructure"]
        PG["PostgreSQL + PostGIS"]
        REDIS["Redis Cache"]
        FB_ADMIN["Firebase Admin SDK"]
        STORAGE["Cloud Storage (S3/Firebase)"]
    end

    UI --> GQL_CLIENT
    GQL_CLIENT -->|"Bearer token"| GUARD
    FB_SDK -->|"ID Token"| GQL_CLIENT
    GPS -->|"lat/lng"| GQL_CLIENT
    CAM -->|"images"| STORAGE

    GUARD -->|"verify token"| FB_ADMIN
    GUARD -->|"resolve user"| GQL_API
    GQL_API --> Resolvers
    Resolvers --> Services
    Services --> DRIZZLE
    DRIZZLE --> PG
    Services -->|"cache feeds"| REDIS
    S_MEDIA -->|"presigned URLs"| STORAGE
    S_CONTACT --> CRYPTO
```

---

## 2. Authentication & Profile Flow

> **Phase:** 1 · **Tables:** `users`, `cities` · **Operations:** `me`, `completeProfile`, `updateProfile`, `updateMyLocation`

```mermaid
flowchart TD
    A["User opens app"] --> B{"Has Firebase\ntoken cached?"}
    B -->|No| C["Show Login Screen\n(Google / Facebook / Email)"]
    B -->|Yes| D["Send token to backend"]
    C --> E["Firebase Auth SDK\nauthenticates user"]
    E --> D

    D --> F["FirebaseAuthGuard\nverifies token"]
    F --> G{"Token valid?"}
    G -->|No| H["401 UNAUTHENTICATED\n→ re-login"]
    G -->|Yes| I{"User row exists\nin DB?"}

    I -->|No| J["Auto-create user row\n(firebase_uid, email,\nprofile_picture_url,\nauth_provider)"]
    I -->|Yes| K["Load cached user\n(60s TTL)"]
    J --> K

    K --> L{"fullName &\nphoneNumber\nset?"}
    L -->|No| M["Show Complete Profile Screen"]
    L -->|Yes| N["✅ Enter App\n(Home Feed)"]

    M --> O["User fills:\n• Full Name\n• Phone Number\n• City (picker or GPS auto-detect)"]
    O --> P["completeProfile mutation"]
    P --> Q["Encrypt phone (AES-256-GCM)\nResolve city_id from GPS\nSet fullName, cityId"]
    Q --> N

    N --> R{"User pulls\nto refresh?"}
    R -->|Yes| S["Send fresh GPS fix"]
    S --> T{"Resolved city ≠\nstored city?"}
    T -->|Yes| U["Show soft prompt:\n'Switch feed to [City]?'"]
    T -->|No| V["Continue with\ncurrent city"]
    U -->|Accept| W["updateMyLocation mutation\n→ update city_id + last_known_location"]
    U -->|Dismiss| V
```

---

## 3. Post Creation Engine

> **Phase:** 2 · **Tables:** `posts`, `post_media`, `post_locations`, + extension tables · **Operations:** `createRescuePost`, `createLostPost`, `createFoundPost`, `createAdoptionPost`, `createProductPost`

```mermaid
flowchart TD
    A["User taps center FAB (+)"] --> B["Open Post Action Sheet"]
    
    B --> C{"Select post type"}
    C -->|"🚨 Rescue Alert"| D1["Rescue Form"]
    C -->|"🔍 Lost Pet"| D2["Lost Pet Form"]
    C -->|"✅ Found Pet"| D3["Found Pet Form"]
    C -->|"🐾 Adoption Listing"| D4["Adoption Form"]
    C -->|"🛒 List a Product"| D5["Product Form"]

    D1 --> E["Multi-step form\n(Step 1 → 2 → 3)"]
    D2 --> E
    D3 --> E
    D4 --> E
    D5 --> E

    E --> F["User uploads photos\n(up to 4 images)"]
    F --> G["requestMediaUploadUrl mutation\n→ get presigned URL + mediaId"]
    G --> H["Flutter uploads image\ndirectly to Cloud Storage"]
    H --> I["User taps Submit"]

    I --> J["createXxxPost mutation\n(with mediaIds[])"]

    J --> K["Backend validates\nrequired fields by type"]
    K --> L{"Valid?"}
    L -->|No| M["Return validation errors"]
    L -->|Yes| N["INSERT into posts table\n(base row)"]

    N --> O["INSERT into extension table\n(rescue_posts / lost_posts /\nfound_posts / adoption_posts /\nproduct_posts)"]

    O --> P["Resolve city_id from\nGPS coordinates"]
    P --> Q["INSERT into post_locations\n(city_id, geom, area_name,\nis_exact_hidden)"]

    Q --> R["Link mediaIds via\nattachMedia"]

    R --> S["Set moderation_status =\nPENDING_AUTO_REVIEW"]
    S --> T["Trigger async\nmoderation check"]

    T --> U["Invalidate Redis feed\ncache for city_id"]
    U --> V["Return created post\nto client"]

    style D1 fill:#FF4D4D22,stroke:#FF4D4D
    style D2 fill:#E8A44A22,stroke:#E8A44A
    style D3 fill:#5B8F7A22,stroke:#5B8F7A
    style D4 fill:#E8A44A22,stroke:#E8A44A
    style D5 fill:#6B9FD422,stroke:#6B9FD4
```

### Required Fields by Post Type

| Field | Rescue | Lost | Found | Adoption | Product |
|-------|--------|------|-------|----------|---------|
| title, description | ✅ | ✅ | ✅ | ✅ | ✅ |
| species | ✅ | ✅ | ✅ | ✅ | — |
| urgency | ✅ | optional | optional | — | — |
| condition/conditionSummary | ✅ | — | ✅ | — | ✅ |
| reporterRole | ✅ | — | — | — | — |
| petName | — | optional | — | ✅ | — |
| gender | — | — | — | ✅ | — |
| vaccinated/neutered/microchipped | — | — | — | ✅ | — |
| dateLastSeen | — | ✅ | — | — | — |
| dateFound | — | — | ✅ | — | — |
| category | — | — | — | — | ✅ |
| price/isFree | — | — | — | — | ✅ |
| cityId + location (GPS) | ✅ | ✅ | ✅ | ✅ | ✅ |
| mediaIds (≥1 photo) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 4. Home Feed (Composite)

> **Phase:** 3 · **Tables:** `posts`, `post_locations`, `rescue_posts`, `adoption_posts` · **Operation:** `homeFeed`

```mermaid
flowchart TD
    A["User opens Home tab"] --> B["homeFeed query\n(geo: GeoFilter)"]

    B --> C["Resolve viewer's city_id\n(from Redis cache or DB)"]
    
    C --> D["Three parallel sub-queries"]

    D --> E["emergencyHighlight\nSingle most urgent nearby\nRescue post (CRITICAL tier)"]
    D --> F["nearbyRescueCases\nTop 5 Rescue/Lost/Found\nsorted: urgency → recency"]
    D --> G["featuredAdoptions\nTop 5 Adoption posts\nsorted: effective_score DESC"]

    E --> H["Compose HomeFeed response"]
    F --> H
    G --> H

    H --> I["Privacy pass:\n• Strip exact coords from\n  Adoption posts\n• Convert distance to\n  'x.x km away' string"]

    I --> J["Return HomeFeed\nto Flutter"]

    J --> K["Flutter renders:\n• Emergency Banner (if exists)\n• Rescue carousel\n• Adoption preview cards"]

    style E fill:#FF4D4D22,stroke:#FF4D4D
    style F fill:#E8A44A22,stroke:#E8A44A
    style G fill:#5B8F7A22,stroke:#5B8F7A
```

---

## 5. Help Feed (Rescue + Lost & Found)

> **Phase:** 3 · **Feels like:** 911 Dispatch Board
> **Sort:** Urgency tier → Recency → Engagement (tiebreak only)

```mermaid
flowchart TD
    A["User opens Help tab"] --> B{"Sub-tab selected?"}
    B -->|"Rescue"| C["Filter: post_type = RESCUE"]
    B -->|"Lost & Found"| D["Filter: post_type\nIN (LOST, FOUND)"]

    C --> E["helpFeed query"]
    D --> E

    E --> F["Resolve viewer's city_id"]
    
    F --> G["Check Redis cache\nfeed:{cityId}:help:{filters}:{cursor}"]
    
    G -->|"Cache HIT"| H["Return cached result"]
    G -->|"Cache MISS"| I["Query PostgreSQL"]

    I --> J["WHERE\n  post_locations.city_id = :cityId\n  AND posts.status = 'ACTIVE'\n  AND posts.post_type IN (:types)"]

    J --> K["Apply filters:\n• species[]\n• urgency[]\n• postTypes[]"]

    K --> L["TTL visibility filter:\n• CRITICAL/URGENT: hide after 7 days\n• MODERATE: hide after 30 days"]

    L --> M["ORDER BY\n  1. urgency_tier DESC\n     (CRITICAL > URGENT > MODERATE)\n  2. created_at DESC\n  3. (upvotes + saves×3) DESC\n     (tiebreak only)"]

    M --> N["LIMIT 20 + cursor pagination"]

    N --> O["Privacy pass:\n• Rescue/Lost/Found: KEEP exact coords\n  (user needs the pin to physically help)\n• Compute distance from viewer"]

    O --> P["Write to Redis\n(TTL 60-120s)"]
    P --> Q["Return PostConnection\nto Flutter"]

    Q --> R["Flutter renders:\n• Species chip\n• Urgency badge (Critical = red)\n• Distance + area\n• Condition summary\n• Helper count\n• Engagement bar (upvote only)\n• 'I Can Help' CTA"]

    style L fill:#FF4D4D22,stroke:#FF4D4D
    style M fill:#E8A44A22,stroke:#E8A44A
```

### Help Feed Ranking Logic (Pseudocode)

```
-- Primary: urgency tier (CRITICAL always above URGENT, always above MODERATE)
-- Secondary: newest first within each tier
-- Tertiary: engagement tiebreak for near-identical timestamps

SELECT p.*, pl.geom, pl.city_id,
       CASE p.urgency
         WHEN 'CRITICAL' THEN 3
         WHEN 'URGENT'   THEN 2
         WHEN 'MODERATE'  THEN 1
       END AS urgency_rank
FROM posts p
JOIN post_locations pl ON pl.post_id = p.id
WHERE pl.city_id = :cityId
  AND p.status = 'ACTIVE'
  AND p.post_type IN ('RESCUE','LOST','FOUND')
  -- TTL filter
  AND (
    (p.urgency IN ('CRITICAL','URGENT') AND p.created_at > NOW() - INTERVAL '7 days')
    OR (p.urgency = 'MODERATE' AND p.created_at > NOW() - INTERVAL '30 days')
    OR p.urgency IS NULL
  )
ORDER BY urgency_rank DESC,
         p.created_at DESC,
         (p.upvote_count + p.save_count * 3) DESC
LIMIT 20;
```

---

## 6. Adopt Feed

> **Phase:** 3 · **Feels like:** Reddit "Hot"
> **Sort modes:** HOT (decayed score) or NEWEST

```mermaid
flowchart TD
    A["User opens Adopt tab"] --> B["adoptFeed query\n(sort, filter, pagination)"]

    B --> C["Resolve viewer's city_id"]

    C --> D{"Sort mode?"}

    D -->|"HOT (default)"| E["ORDER BY\neffective_score DESC"]
    D -->|"NEWEST"| F["ORDER BY\ncreated_at DESC"]

    E --> G["Query PostgreSQL"]
    F --> G

    G --> H["WHERE\n  post_locations.city_id = :cityId\n  AND posts.status = 'ACTIVE'\n  AND posts.post_type = 'ADOPTION'"]

    H --> I["Apply filters:\n• species[]\n• gender\n• ageUnit\n• personalityTags[]\n• vaccinatedOnly"]

    I --> J["Privacy pass:\n• NEVER send exact coords\n• Return city + area_name only\n• Compute 'x.x km away' string"]

    J --> K["Return PostConnection\nto Flutter"]

    K --> L["Flutter renders:\n• Pet photo + species chip\n• Save heart ♡\n• Pet name, breed, age\n• Personality tags\n• Care notes\n• Engagement bar (upvote only)\n• 'Ask to Adopt' CTA"]

    style E fill:#E8A44A22,stroke:#E8A44A
```

### Score Computation (Background Job or Trigger)

```mermaid
flowchart LR
    A["On upvote/save event"] --> B["Compute raw_score:\n(upvotes × 1) + (saves × 3)"]
    B --> C["Compute effective_score:\nraw_score / (age_hours + 2)^1.5"]
    C --> D["UPDATE posts\nSET effective_score = :score\nWHERE id = :postId"]
    D --> E["Invalidate Redis cache\nfor affected city"]
```

> [!TIP]
> `effective_score` can be recomputed periodically (every 5-15 min via cron) rather than on every vote, since the decay component changes over time regardless of new votes.

---

## 7. Market Feed

> **Phase:** 3 · **Feels like:** OLX / Dubizzle
> **Sort:** Recency (with bump), no voting

```mermaid
flowchart TD
    A["User opens Market tab"] --> B["marketFeed query\n(sort, filter, pagination)"]

    B --> C["Resolve viewer's city_id"]

    C --> D{"Sort mode?"}

    D -->|"NEWEST (default)"| E["ORDER BY\nCOALESCE(last_bumped_at,\ncreated_at) DESC"]
    D -->|"NEAREST"| F["ORDER BY\nST_Distance(geom,\nviewer_location) ASC"]
    D -->|"PRICE_LOW_TO_HIGH"| G["ORDER BY\nprice_amount ASC\nNULLS LAST"]
    D -->|"PRICE_HIGH_TO_LOW"| H["ORDER BY\nprice_amount DESC\nNULLS LAST"]

    E --> I["Query PostgreSQL"]
    F --> I
    G --> I
    H --> I

    I --> J["WHERE\n  post_locations.city_id = :cityId\n  AND posts.status = 'ACTIVE'\n  AND posts.post_type = 'PRODUCT'"]

    J --> K["Apply filters:\n• category[]\n• condition[]\n• priceMin / priceMax\n• freeOnly"]

    K --> L["Privacy pass:\n• NEVER send exact coords\n• Return city + area_name\n• Compute 'x.x km away'"]

    L --> M["Return PostConnection\nto Flutter"]

    M --> N["Flutter renders:\n• Product image grid (2 cols)\n• Seller badge\n• Product name + price\n• Condition badge\n• 'Contact Seller' button\n  (direct — no request flow)"]

    style E fill:#6B9FD422,stroke:#6B9FD4
```

### Seller Bump Flow

```mermaid
flowchart LR
    A["Seller taps 'Renew Listing'"] --> B["bumpPost mutation"]
    B --> C{"Last bumped\n< 24-48 hrs ago?"}
    C -->|"Too soon"| D["Reject: cooldown\nnot elapsed"]
    C -->|"OK"| E["UPDATE posts\nSET last_bumped_at = NOW()"]
    E --> F["Post jumps to top\nof NEWEST sort"]
```

---

## 8. Contact Request Flow (WhatsApp Gateway)

> **Phase:** 4 · **Tables:** `contact_requests`, `notifications` · **Applies to:** Rescue, Lost, Found, Adoption (NOT Product)

```mermaid
flowchart TD
    A["Viewer taps\n'I Can Help' / 'Ask to Adopt'"] --> B["requestContact mutation\n(postId, message)"]

    B --> C{"Post type =\nPRODUCT?"}
    C -->|"Yes"| D["❌ Reject: Product uses\ndirect sellerContact"]
    C -->|"No"| E{"Existing request\nfrom this user?"}

    E -->|"Yes"| F["❌ Reject: duplicate\n(one per user per post)"]
    E -->|"No"| G["INSERT contact_requests\nstatus = PENDING"]

    G --> H["Create notification\nfor post owner:\n'New contact request\nfrom [name]'"]

    H --> I["Post owner sees\nnotification + request"]

    I --> J{"Owner decision?"}

    J -->|"APPROVE"| K["respondToContactRequest\n(decision: APPROVE)"]
    J -->|"REJECT"| L["respondToContactRequest\n(decision: REJECT)"]

    K --> M["UPDATE contact_requests\nSET status = 'APPROVED',\nwhatsapp_unlocked = true,\nresponded_at = NOW()"]

    L --> N["UPDATE contact_requests\nSET status = 'REJECTED',\nresponded_at = NOW()"]

    M --> O["Decrypt owner's phone\n(AES-256-GCM)"]
    O --> P["Generate wa.me/ link"]
    P --> Q["Notify requester:\n'Request approved!\nContact via WhatsApp'"]

    N --> R["Notify requester:\n'Request was declined'"]

    Q --> S["Requester sees ContactInfo:\n• phoneNumber\n• whatsappLink"]
    S --> T["Tap → Opens WhatsApp\nwith pre-filled message"]

    style D fill:#FF4D4D22,stroke:#FF4D4D
    style F fill:#FF4D4D22,stroke:#FF4D4D
    style M fill:#5B8F7A22,stroke:#5B8F7A
```

### Product Contact (No Request Flow)

```mermaid
flowchart LR
    A["Viewer taps\n'Contact Seller'"] --> B["ProductPost.sellerContact\nresolver"]
    B --> C["Decrypt seller's phone\n(AES-256-GCM)"]
    C --> D["Return ContactInfo:\n• phoneNumber\n• whatsappLink"]
    D --> E["Opens WhatsApp directly\n— no approval needed"]
```

---

## 9. Adoption Application Flow (Responsible Matching)

> **Phase:** 4 · **Tables:** `adoption_applications`, `notifications` · **Operation:** `submitAdoptionApplication`, `reviewAdoptionApplication`

```mermaid
flowchart TD
    A["Viewer taps 'Apply via\nResponsible Matching'\non Adoption Detail"] --> B["Show Application Form\n(multi-step)"]

    B --> C["Step 1: Preferences\n• Species / Breed / Age / Gender"]
    C --> D["Step 2: Home & Lifestyle\n• Living situation\n• Outdoor access\n• Other pets / children\n• Hours at home"]
    D --> E["Step 3: Experience\n• Previous pets\n• Why adopt"]
    E --> F["Step 4: Consent\n• Home visit consent\n• Vet reference"]

    F --> G["submitAdoptionApplication\nmutation"]

    G --> H{"Already applied\nto this post?"}
    H -->|"Yes"| I["❌ Reject: duplicate"]
    H -->|"No"| J["INSERT adoption_applications\nstatus = PENDING"]

    J --> K["Notify listing owner:\n'New adoption application\nfrom [name]'"]

    K --> L["Owner reviews application\n(visible on their post\nunder 'Applications' tab)"]

    L --> M{"Owner decision?"}

    M -->|"APPROVE"| N["reviewAdoptionApplication\n(decision: APPROVE)"]
    M -->|"REJECT"| O["reviewAdoptionApplication\n(decision: REJECT)"]

    N --> P["UPDATE adoption_applications\nSET status = 'APPROVED',\nresponded_at = NOW()"]
    P --> Q["Notify applicant:\n'Your application\nwas approved! 🎉'"]
    Q --> R["Unlock contact info\n(same as contact request\napproval flow)"]

    O --> S["UPDATE adoption_applications\nSET status = 'REJECTED',\nresponded_at = NOW()"]
    S --> T["Notify applicant:\n'Application not\nselected this time'"]

    style I fill:#FF4D4D22,stroke:#FF4D4D
    style P fill:#5B8F7A22,stroke:#5B8F7A
```

---

## 10. Upvote & Save Flow

> **Phase:** 2 · **Tables:** `post_upvotes`, `post_saves`, `posts` (denormalized counts)

```mermaid
flowchart TD
    A["User taps ⬆ Upvote\nor ♡ Save"] --> B{"Which action?"}

    B -->|"Upvote"| C["toggleUpvote mutation\n(postId)"]
    B -->|"Save"| D["toggleSave mutation\n(postId)"]

    C --> E{"Post type =\nPRODUCT?"}
    E -->|"Yes"| F["❌ Reject: Market\ndoesn't vote"]
    E -->|"No"| G{"Row exists in\npost_upvotes?"}

    G -->|"Yes (undo)"| H["DELETE from post_upvotes\nDECREMENT posts.upvote_count"]
    G -->|"No (new)"| I["INSERT into post_upvotes\nINCREMENT posts.upvote_count"]

    D --> J{"Row exists in\npost_saves?"}
    J -->|"Yes (undo)"| K["DELETE from post_saves\nDECREMENT posts.save_count"]
    J -->|"No (new)"| L["INSERT into post_saves\nINCREMENT posts.save_count"]

    H --> M["Recompute effective_score\n(for Adopt feed ranking)"]
    I --> M
    K --> M
    L --> M

    I --> N["Create notification\nfor post owner:\n'Your post got an upvote'"]
    L --> O["Create notification\nfor post owner:\n'Your post was saved'"]

    M --> P["Return VoteResult\nor SaveResult"]

    style F fill:#FF4D4D22,stroke:#FF4D4D
```

---

## 11. Media Upload Flow

> **Phase:** 2 · **Tables:** `post_media` · **Pattern:** Presigned URL (client uploads directly to storage)

```mermaid
flowchart TD
    A["User picks photo\nfrom camera/gallery"] --> B["Crop to square"]
    B --> C["requestMediaUploadUrl mutation\n(contentType, fileSizeBytes)"]

    C --> D["Backend generates:\n• mediaId (UUID)\n• presigned upload URL\n• expiry timestamp"]

    D --> E["Return MediaUploadTicket\nto Flutter"]

    E --> F["Flutter uploads image\ndirectly to Cloud Storage\nusing presigned URL"]

    F --> G{"Upload\nsuccessful?"}
    G -->|"No"| H["Show error\nretry upload"]
    G -->|"Yes"| I["mediaId is ready\nfor post submission"]

    I --> J["On createXxxPost:\npass mediaIds[] array"]

    J --> K["Backend: attachMedia\nlinks mediaIds to post_id\nsets sort_order"]

    style F fill:#E8A44A22,stroke:#E8A44A
```

> [!IMPORTANT]
> The client never sends image bytes through GraphQL. Images go directly to Cloud Storage via presigned URL. Only the `mediaId` reference passes through the API — this keeps the GraphQL payload small and fast.

---

## 12. Notification Engine

> **Phase:** 5 · **Tables:** `notifications` · **Operations:** `notifications`, `unreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`, `notificationReceived` (subscription)

```mermaid
flowchart TD
    A["Event occurs"] --> B{"Event type?"}

    B -->|"Upvote"| C["NEW_UPVOTE\n→ post owner"]
    B -->|"Save"| D["POST_SAVED\n→ post owner"]
    B -->|"Contact request\nreceived"| E["CONTACT_REQUEST_RECEIVED\n→ post owner"]
    B -->|"Contact request\napproved"| F["CONTACT_REQUEST_APPROVED\n→ requester"]
    B -->|"Contact request\nrejected"| G["CONTACT_REQUEST_REJECTED\n→ requester"]
    B -->|"Adoption app\nreceived"| H["ADOPTION_APPLICATION_RECEIVED\n→ post owner"]
    B -->|"Adoption app\napproved"| I["ADOPTION_APPLICATION_APPROVED\n→ applicant"]
    B -->|"Adoption app\nrejected"| J["ADOPTION_APPLICATION_REJECTED\n→ applicant"]
    B -->|"Post flagged"| K["POST_FLAGGED_FOR_REVIEW\n→ all admins"]
    B -->|"Post removed\nby admin"| L["POST_REMOVED_BY_ADMIN\n→ post owner"]
    B -->|"System"| M["SYSTEM_ANNOUNCEMENT\n→ all users"]

    C --> N["INSERT notifications\n(recipient_id, type,\ntitle, body,\nrelated_post_id)"]
    D --> N
    E --> N
    F --> N
    G --> N
    H --> N
    I --> N
    J --> N
    K --> N
    L --> N
    M --> N

    N --> O["Emit via GraphQL\nSubscription:\nnotificationReceived"]

    O --> P["Flutter receives\npush via WebSocket"]
    P --> Q["Update unread badge\non bottom nav bell"]
    Q --> R["User taps bell →\nNotification Panel"]
    R --> S["notifications query\n(unreadOnly, pagination)"]
    S --> T["User taps notification →\nNavigate to related post"]
    T --> U["markNotificationRead\nmutation"]
```

---

## 13. Content Moderation Pipeline

> **Phase:** 5 · **Tables:** `posts`, `post_reports`, `notifications` · **Operations:** `reportPost`, `clearModerationFlag`, `adminRemovePost`, `flaggedPosts`

```mermaid
flowchart TD
    subgraph Auto ["Automated (Post-Publish)"]
        A1["Post created →\nstatus = ACTIVE\nmoderation_status =\nPENDING_AUTO_REVIEW"]
        A1 --> A2["Background classifier\nruns async check:\n• Is content about animals?\n• Spam / scam signals?\n• Inappropriate content?"]
        A2 --> A3{"Classification?"}
        A3 -->|"Clean"| A4["UPDATE moderation_status\n= CLEAN"]
        A3 -->|"Flagged"| A5["UPDATE moderation_status\n= FLAGGED"]
        A5 --> A6["Notify all admins:\nPOST_FLAGGED_FOR_REVIEW\n'Post may contain\ninappropriate content'"]
    end

    subgraph Community ["Community Reports"]
        B1["User taps 'Report Post'"] --> B2["reportPost mutation\n(postId, reason, details)"]
        B2 --> B3["INSERT post_reports"]
        B3 --> B4{"Report threshold\nexceeded?\n(e.g. ≥3 reports)"}
        B4 -->|"Yes"| B5["Auto-flag:\nmoderation_status = FLAGGED"]
        B5 --> A6
        B4 -->|"No"| B6["Queue for review\n(no immediate action)"]
    end

    subgraph Admin ["Admin Actions"]
        A6 --> C1["Admin opens\nflaggedPosts query"]
        C1 --> C2["Admin reviews post"]
        C2 --> C3{"Decision?"}
        C3 -->|"Clear flag"| C4["clearModerationFlag\n→ moderation_status = CLEAN"]
        C3 -->|"Remove post"| C5["adminRemovePost\n→ status = REMOVED\n+ reason stored"]
        C5 --> C6["Notify post owner:\nPOST_REMOVED_BY_ADMIN\n'Your post was removed:\n[reason]'"]
    end

    style A5 fill:#FF4D4D22,stroke:#FF4D4D
    style C4 fill:#5B8F7A22,stroke:#5B8F7A
    style C5 fill:#FF4D4D22,stroke:#FF4D4D
```

---

## 14. Implementation Dependency Graph & Phase Order

> This is the build sequence — each phase depends on the ones above it.

```mermaid
graph TD
    subgraph P1 ["Phase 1 — Foundation (Week 1-2)"]
        P1A["cities table + seed data"]
        P1B["users table alignment\n(already exists, add FK\nto cities, add\nlast_known_location)"]
        P1C["completeProfile mutation\n(city picker + GPS)"]
        P1D["updateMyLocation mutation"]
    end

    subgraph P2 ["Phase 2 — Post Engine (Week 2-3)"]
        P2A["All enums in PostgreSQL"]
        P2B["posts base table"]
        P2C["5 extension tables:\nrescue, lost, found,\nadoption, product"]
        P2D["post_locations table\n+ PostGIS + GIST index"]
        P2E["post_media table +\npresigned URL flow"]
        P2F["Create mutations\n(1 per post type)"]
        P2G["Update + Delete\nmutations"]
    end

    subgraph P3 ["Phase 3 — Feeds & Ranking (Week 3-4)"]
        P3A["post_upvotes +\npost_saves tables"]
        P3B["toggleUpvote +\ntoggleSave mutations"]
        P3C["Effective score\ncomputation (cron/trigger)"]
        P3D["helpFeed query +\nurgency-first sort"]
        P3E["adoptFeed query +\nhot/newest sort"]
        P3F["marketFeed query +\nrecency/price/distance sort"]
        P3G["homeFeed composite query"]
        P3H["Redis feed caching"]
        P3I["bumpPost mutation\n+ cooldown logic"]
    end

    subgraph P4 ["Phase 4 — Contact & Matching (Week 4-5)"]
        P4A["contact_requests table"]
        P4B["requestContact +\nrespondToContactRequest"]
        P4C["WhatsApp wa.me/\nlink generation"]
        P4D["adoption_applications\ntable"]
        P4E["submitAdoptionApplication +\nreviewAdoptionApplication"]
        P4F["Product: direct\nsellerContact resolver"]
    end

    subgraph P5 ["Phase 5 — Notifications (Week 5-6)"]
        P5A["notifications table"]
        P5B["NotificationService:\nevent-driven creation"]
        P5C["notifications query +\nunreadCount"]
        P5D["markRead mutations"]
        P5E["notificationReceived\nsubscription (WebSocket)"]
    end

    subgraph P6 ["Phase 6 — Moderation (Week 6)"]
        P6A["post_reports table"]
        P6B["reportPost mutation"]
        P6C["ModerationService:\nauto-classifier"]
        P6D["Admin: flaggedPosts,\nclearFlag, removePost"]
    end

    subgraph P7 ["Phase 7 — Stale & Lifecycle (Week 7)"]
        P7A["resolvePost mutation\n(Rescue/Lost/Found)"]
        P7B["markProductSold mutation"]
        P7C["Stale listing nudge\ncron (3 weeks Adopt,\n30-45 days Market)"]
        P7D["Auto-archive on\nno response"]
    end

    subgraph P8 ["Phase 8 — Polish & QA (Week 7-8)"]
        P8A["Composite DB indexes\n(from ranking doc)"]
        P8B["Redis cache versioning\n(version-counter pattern)"]
        P8C["Swagger/API docs"]
        P8D["End-to-end testing"]
        P8E["Docker + deployment"]
    end

    %% Dependencies
    P1A --> P1B
    P1B --> P1C
    P1C --> P1D

    P1A --> P2D
    P1B --> P2B
    P2A --> P2B
    P2A --> P2C
    P2B --> P2C
    P2B --> P2D
    P2B --> P2E
    P2C --> P2F
    P2D --> P2F
    P2E --> P2F
    P2F --> P2G

    P2B --> P3A
    P2G --> P3B
    P3A --> P3B
    P3B --> P3C
    P2D --> P3D
    P3C --> P3E
    P2D --> P3F
    P3D --> P3G
    P3E --> P3G
    P3F --> P3G
    P3G --> P3H
    P2G --> P3I

    P2B --> P4A
    P4A --> P4B
    P4B --> P4C
    P2C --> P4D
    P4D --> P4E
    P2C --> P4F

    P4B --> P5A
    P4E --> P5A
    P5A --> P5B
    P5B --> P5C
    P5C --> P5D
    P5D --> P5E

    P2B --> P6A
    P6A --> P6B
    P6B --> P6C
    P6C --> P6D

    P2G --> P7A
    P2G --> P7B
    P3C --> P7C
    P7C --> P7D

    P3D --> P8A
    P3H --> P8B
    P2F --> P8C
    P8C --> P8D
    P8D --> P8E

    style P1 fill:#E8A44A11,stroke:#E8A44A
    style P2 fill:#6B9FD411,stroke:#6B9FD4
    style P3 fill:#5B8F7A11,stroke:#5B8F7A
    style P4 fill:#9B7AD411,stroke:#9B7AD4
    style P5 fill:#FF4D4D11,stroke:#FF4D4D
    style P6 fill:#FF4D4D11,stroke:#FF4D4D
    style P7 fill:#E8A44A11,stroke:#E8A44A
    style P8 fill:#4A7A6B11,stroke:#4A7A6B
```

---

## Phase Summary Table

| Phase | What | Duration | Depends On | DB Tables |
|-------|------|----------|------------|-----------|
| **1** | Foundation | Week 1-2 | — | `cities`, `users` (update) |
| **2** | Post Engine | Week 2-3 | Phase 1 | `posts`, 5 extension tables, `post_locations`, `post_media` |
| **3** | Feeds & Ranking | Week 3-4 | Phase 2 | `post_upvotes`, `post_saves` |
| **4** | Contact & Matching | Week 4-5 | Phase 2 | `contact_requests`, `adoption_applications` |
| **5** | Notifications | Week 5-6 | Phase 4 | `notifications` |
| **6** | Moderation | Week 6 | Phase 2 | `post_reports` |
| **7** | Lifecycle | Week 7 | Phase 3 | — (logic only) |
| **8** | Polish & QA | Week 7-8 | All | — (indexes, caching, docs) |

> [!IMPORTANT]
> **Phases 3-4 can run in parallel** since feeds and contact/matching are independent modules that both depend only on Phase 2. Similarly, **Phases 6-7 can run in parallel** with Phase 5.
