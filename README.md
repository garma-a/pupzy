<div align="center">

# 🐾 Pubzy
### *Rescue. Adopt. Care.*

**Egypt’s premier mobile-first pet community ecosystem & emergency response platform.**

[![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)](https://flutter.dev/)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![GraphQL](https://img.shields.io/badge/GraphQL-E10098?style=for-the-badge&logo=graphql&logoColor=white)](https://graphql.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-006400?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgis.net/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare_R2-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/products/orca-r2/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Railway](https://img.shields.io/badge/Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white)](https://railway.app/)

---

</div>

## 🎬 Project Overview & Video Demo

Pubzy is a modern, high-performance mobile application engineered to solve critical animal welfare challenges in Egypt. By combining **emergency rescue dispatching**, **lost & found reporting**, **responsible pet adoption matching**, and a **community pet marketplace**, Pubzy bridges the emotional and operational gap left by generic classified platforms like OLX or Dubizzle.

https://github.com/user-attachments/assets/final_pupzy.mp4

<div align="center">
  <video src="./final_pupzy.mp4" controls width="100%" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.15);"></video>
  <p><em>🎥 Watch the full Pubzy Mobile Application walkthrough video above!</em></p>
</div>

---

## 🌟 Key Features & Verticals

Pubzy is built around four specialized verticals, each designed with tailored UX flows, spatial logic, and engagement mechanics:

```
                          ┌──────────────────────────────────────────┐
                          │               PUBZY PLATFORM             │
                          └────────────────────┬─────────────────────┘
                                               │
       ┌──────────────────┬────────────────────┴───────────────────┬──────────────────┐
       ▼                  ▼                                        ▼                  ▼
🚨 Emergency Help    🔍 Lost & Found                        🏠 Pet Adoption     🛒 Pet Marketplace
   Dispatch Board       Community Network                      Matchmaking         Classifieds Engine
```

### 🚨 1. Emergency Rescue Dispatch (`RESCUE`)
* **911-Style Dispatch Board**: High-priority real-time feed sorted strictly by urgency (`CRITICAL` → `URGENT` → `MODERATE`).
* **Coordination Signals**: Indicates reporter role (`REPORTING` - spotted & left, `ON_SITE` - waiting with animal, `CAN_TRANSPORT` - ready to move).
* **Live GPS Coordinates**: Returns exact PostGIS latitude/longitude with one-tap native Google Maps deep linking (`maps.google.com/?q={lat},{lng}`) via `url_launcher`.
* **Zero Expiry**: Rescue listings are never auto-removed until marked `RESOLVED`.

### 🔍 2. Lost & Found Network (`LOST`)
* **Dual-Direction Matching**: Unifies both `LOST_PET` (owners seeking lost pets) and `FOUND_STRAY` (citizens hosting or spotting strays).
* **Detailed Descriptors**: Filter by species, breed, color, markings, collar/ID tag, date last seen/found, and animal health condition.
* **Resolution Tracking**: Instant status toggles for `REUNITED` and `RESOLVED`.

### 🏠 3. Responsible Pet Adoption (`ADOPTION`)
* **Privacy-First Matching**: Owner contact details are protected behind a multi-step adoption application gate.
* **Smart Screening Questionnaire**: Evaluates living situation (apartment, yard, farm), prior experience, children/pet compatibility, vet references, and home visit consent.
* **Hot Score Ranking**: Reddit-inspired engagement algorithm surfaces active, highly-interacted adoption listings organically.

### 🛒 4. Community Pet Marketplace (`PRODUCT`)
* **Zero-Fee Classifieds**: Direct buyer-to-seller connections without middleman commission fees or cart friction.
* **Supplies & Care**: Categorized browsing for `CARE`, `FOOD`, `TRANSPORT`, `ACCESSORIES`, `GROOMING`, and `MEDICAL_SUPPLIES`.
* **Instant WhatsApp Link**: One-tap interaction generating encrypted `wa.me/` direct contact links dynamically.
* **View-Driven Ranking**: Driven by buyer activity signals with automated inactivity pruning after 14 days of zero views.

---

## 🏗️ System Architecture

Pubzy follows **Clean Architecture** and **Domain-Driven Design (DDD)** principles across both backend and mobile applications.

```mermaid
graph TB
    subgraph Client ["📱 Flutter Mobile App (Dart)"]
        UI["UI Components & Views"]
        RIVERPOD["Riverpod State Management"]
        GQL_CLIENT["GraphQL Client (Ferry / GraphQL Flutter)"]
        FB_SDK["Firebase Auth SDK"]
        LAUNCHER["url_launcher (Maps & WhatsApp)"]
    end

    subgraph Infrastructure_Cloud ["☁️ Cloud Services"]
        FB_AUTH["Firebase Auth Server"]
        R2["Cloudflare R2 (Object Storage)"]
        RAILWAY["Railway Application Hosting"]
    end

    subgraph Backend ["⚡ NestJS GraphQL Backend (Node.js)"]
        GUARD["FirebaseAuthGuard"]
        RESOLVERS["GraphQL Resolvers (Code-First)"]
        
        subgraph Services ["Core Services"]
            POST_SVC["PostsService"]
            FEED_SVC["FeedService"]
            RANK_SVC["RankingService"]
            VIEW_SVC["ViewsService"]
            CONTACT_SVC["ContactService (AES-256)"]
        end
        
        DRIZZLE["Drizzle ORM"]
    end

    subgraph Database_Layer ["🗄️ Persistence Layer"]
        PG[("PostgreSQL 16 + PostGIS\n(Class Table Inheritance)")]
        REDIS[("Redis Cache & Buffer\n(Feed Cache & View Deduplication)")]
    end

    UI --> RIVERPOD
    RIVERPOD --> GQL_CLIENT
    GQL_CLIENT -->|"Bearer JWT"| GUARD
    FB_SDK -->|"ID Token"| GQL_CLIENT

    GUARD -->|"Verify Token"| FB_AUTH
    GUARD --> RESOLVERS
    RESOLVERS --> Services
    Services --> DRIZZLE
    Services -->|"Decrypted Phone -> wa.me Link"| LAUNCHER
    
    DRIZZLE --> PG
    VIEW_SVC -->|"Deduplicate & Buffer Views"| REDIS
    FEED_SVC -->|"Cache Feed Pages"| REDIS
    POST_SVC -->|"Presigned Upload URLs"| R2
```

---

## 🧮 Feed Algorithms & Mathematical Models

To eliminate spam and manual "bumping" mechanics (e.g. OLX last-bumped mechanisms), Pubzy utilizes dynamic organic scoring with logarithmic time decay.

### 🔥 Adopt Feed (`effective_score`)
Surfaces adoption listings based on active community intent (upvotes, saves, and views):

$$\text{Score}_{\text{Adopt}} = \frac{3 \cdot \text{upvotes} + 2 \cdot \text{saves} + 0.1 \cdot \text{views} + 1}{(\text{age\_hours} + 2)^{1.5}}$$

* **Upvotes ($\times 3$) & Saves ($\times 2$)**: High-intent explicit community signals.
* **Views ($\times 0.1$)**: Low-weight passive traffic signal.
* **Time Decay ($(\text{age\_hours} + 2)^{1.5}$)**: Ensures fresh adoption posts gain visibility while older posts naturally decay unless backed by strong engagement.

### 📈 Marketplace Feed (`effective_score`)
Ranks product listings by buyer demand without upvote clutter:

$$\text{Score}_{\text{Market}} = \frac{1 \cdot \text{views} + 5 \cdot \text{saves} + 1}{(\text{age\_hours} + 2)^{1.5}}$$

* **Saves ($\times 5$)**: High-intent purchase bookmark signal.
* **Views ($\times 1$)**: Primary organic browsing metric.
* **Upvotes**: Disabled (`upvote_count` remains 0).

---

## ⚡ High-Throughput View Tracking (Redis Buffer)

Direct PostgreSQL database writes on every post view would create severe write bottlenecks under high traffic. Pubzy implements a high-performance **Redis-buffered view pipeline**:

```mermaid
sequenceDiagram
    autonumber
    actor User as Flutter Client
    participant API as NestJS GraphQL
    participant Redis as Redis Cache
    participant Cron as NestJS Cron Worker
    participant PG as PostgreSQL 16 DB

    User->>API: POST /posts/{postId}/view (Async / Fire-and-Forget)
    API->>Redis: SET view_dedup:{postId}:{userId} 1 NX EX 3600
    
    alt View is Duplicate (Within 1 Hour)
        Redis-->>API: Key Exists (Lock Active)
        API-->>User: 200 OK (Ignored)
    else View is New & Unique
        Redis-->>API: Key Created
        API->>Redis: INCR view_buffer:{postId}
        API-->>User: 200 OK (Count Incremented in Buffer)
    end

    Note over Cron,PG: Every 2-3 Minutes (Batch View Flush Cron)
    Cron->>Redis: SCAN view_buffer:*
    Redis-->>Cron: Return buffered view counts per postId
    Cron->>PG: UPDATE posts SET view_count = view_count + N
    Cron->>PG: Recompute effective_score & update last_engaged_at
    Cron->>Redis: DEL view_buffer:{postId}
```

---

## 🔐 Geolocation & Contact Privacy Architecture

### 📍 Spatial Privacy Matrix
| Post Type | Coordinate Exposure | Location Returned | Primary Action |
| :--- | :--- | :--- | :--- |
| **`RESCUE`** | **Full (Exact GPS)** | `{ latitude, longitude }` | Open in Google Maps (`maps.google.com/?q=lat,lng`) |
| **`LOST`** | **Full (Exact GPS)** | `{ latitude, longitude }` | Open in Google Maps (`maps.google.com/?q=lat,lng`) |
| **`ADOPTION`** | 🔒 **Masked** | `City Name + Distance (km)` | Submit Adoption Application Gate |
| **`PRODUCT`** | 🔒 **Masked** | `City Name + Distance (km)` | Request Contact / WhatsApp Link |

### 🔒 Phone Number Security (Zero-Storage Architecture)
1. **AES-256-GCM Encryption**: User phone numbers are stored strictly encrypted at rest inside PostgreSQL.
2. **On-The-Fly Decryption**: Phone numbers are decrypted only when an owner explicitly approves a contact request or application.
3. **Zero Storage Client-side**: The backend computes a formatted `wa.me/{phone}` URL dynamically at GraphQL query time. Raw numbers are never stored in client memory or exposed in feed payloads.

---

## 🗄️ Database Schema & Class Table Inheritance (CTI)

Pubzy utilizes **Class Table Inheritance (CTI)** in PostgreSQL to combine polymorphic feed performance with strong table-level type constraints.

```
                           ┌──────────────────────────────────────────┐
                           │               posts (Base)               │
                           ├──────────────────────────────────────────┤
                           │ id: uuid (PK)                            │
                           │ creator_id: uuid (FK -> users)           │
                           │ post_type: post_type (ENUM)              │
                           │ status: post_status (ENUM)               │
                           │ city_id: uuid (FK -> cities)             │
                           │ coordinates: geometry(POINT, 4326)      │
                           │ view_count / upvote_count / save_count   │
                           │ effective_score: float                   │
                           │ last_engaged_at: timestamptz             │
                           └────────────────────┬─────────────────────┘
                                                │ (1:1 Joined on Detail Screen Only)
       ┌──────────────────┬─────────────────────┴─────────────────────┬──────────────────┐
       ▼                  ▼                                           ▼                  ▼
┌──────────────┐   ┌──────────────┐                            ┌──────────────┐   ┌──────────────┐
│ rescue_posts │   │  lost_posts  │                            │adoption_posts│   │product_posts │
├──────────────┤   ├──────────────┤                            ├──────────────┤   ├──────────────┤
│ post_id (PK) │   │ post_id (PK) │                            │ post_id (PK) │   │ post_id (PK) │
│ species      │   │ report_type  │                            │ pet_name     │   │ category     │
│ condition    │   │ breed        │                            │ age_value    │   │ condition    │
│ reporter_role│   │ date_seen    │                            │ personality  │   │ price_amount │
└──────────────┘   └──────────────┘                            └──────────────┘   └──────────────┘
```

### ⚡ Optimized Indexing Strategy
* **Geospatial Queries**: PostGIS GIST Index on `posts.coordinates` for `ST_DWithin` spatial radius filtering.
* **Partial Feed Indexes**:
  * `idx_posts_help_feed`: `(city_id, post_type, urgency, created_at) WHERE status='ACTIVE' AND post_type IN ('RESCUE','LOST')`
  * `idx_posts_adopt_score`: `(city_id, effective_score, created_at) WHERE status='ACTIVE' AND post_type='ADOPTION'`
  * `idx_posts_market_score`: `(city_id, effective_score, created_at) WHERE status='ACTIVE' AND post_type='PRODUCT'`
  * `idx_posts_market_category`: `(city_id, market_category, effective_score) WHERE status='ACTIVE' AND post_type='PRODUCT'`
* **Automated Counter Triggers**: PostgreSQL trigger `user_post_count_trigger` automatically maintains all 5 user activity counters in sync across direct DB operations and AdminJS updates.

---

## 🛠️ Technology Stack Breakdown

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Mobile App** | **Flutter (Dart 3.x)** | Cross-platform iOS & Android application |
| **State Management** | **Riverpod 2.x** | Reactive state & dependency injection |
| **API Paradigm** | **GraphQL (Code-First NestJS)** | Strongly-typed API queries & mutations |
| **Backend Framework** | **NestJS (Node.js & TypeScript)** | Modular enterprise microservice backend |
| **ORM** | **Drizzle ORM** | Type-safe SQL query builder & migration engine |
| **Database** | **PostgreSQL 16 + PostGIS** | Relational data & spatial GIS indexing (SRID 4326) |
| **Cache & Buffer** | **Redis** | Feed cache, view deduplication & atomic view counters |
| **Authentication** | **Firebase Auth** | Social login (Google & Facebook) via FlutterFire |
| **Cloud Storage** | **Cloudflare R2** | Zero-egress S3-compatible image hosting via presigned URLs |
| **Deployment** | **Docker & Railway** | Containerized backend deployment & CI/CD pipeline |

---

## 🚀 Getting Started & Local Setup

### Prerequisites
* **Flutter SDK**: `>=3.19.0`
* **Node.js**: `>=20.x` & `npm`
* **Docker & Docker Compose** (for local Postgres & Redis)

### 1. Database & Cache Infrastructure
```bash
# Start PostgreSQL (with PostGIS extension) and Redis containers
docker run --name pupzy-postgres -e POSTGRES_DB=pupzy -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgis/postgis:16-3.4
docker run --name pupzy-redis -p 6379:6379 -d redis:alpine
```

### 2. Backend Setup (`NestJS`)
```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env-example .env

# Run Drizzle DB migrations & seed city database
npm run db:push
npm run db:seed

# Start NestJS backend development server
npm run start:dev
```
The GraphQL Playground will be accessible at: `http://localhost:3000/graphql`.

### 3. Frontend Setup (`Flutter`)
```bash
# Navigate to frontend directory
cd frontend

# Get Flutter packages
flutter pub get

# Run on connected device or simulator
flutter run
```

---

## 📋 Naming Conventions & Code Quality Policy

Pubzy enforces a **Strict No-Abbreviations Policy** across all database columns, code symbols, GraphQL types, and variable names for long-term codebase maintainability:

| ❌ Forbidden Abbreviation | ✅ Mandatory Full Name |
| :--- | :--- |
| `name_en` / `name_ar` | `name_english` / `name_arabic` |
| `geom` / `center_geom` | `coordinates` / `center_point` |
| `firebase_uid` | `firebase_user_id` |
| `url` / `r2_key` | `public_url` / `cloudflare_storage_key` |
| `content_type` | `file_content_type` |
| `has_collar` | `has_collar_with_identification_tag` |

---

## 👥 Core Team & Credits

| Role | Contributor | Stack |
| :--- | :--- | :--- |
| **Backend & Architecture** | **Garma** | NestJS, PostgreSQL/PostGIS, Drizzle ORM, Redis, GraphQL |
| **Mobile Frontend** | **Matheo Mochles** | Flutter, Riverpod, Ferry, GraphQL |

---

<div align="center">

Made with ❤️ in Egypt for animal rescue & protection across the nation.

**[Pubzy — Rescue. Adopt. Care. 🐾]**

</div>
