# Three-Service Railway Release & Deployment Guide

This document defines the deployment configuration, environment contract, migration flow, and operational guidelines for the three-service Pupzy architecture on Railway.

---

## 1. Topology Overview

The launch architecture consists of **exactly three services** within a single Railway project:

```
                  ┌────────────────────────┐
                  │   Railway Private Net  │
                  │                        │
  Internet ───►  │  [1] Main NestJS API   ├──┐
                 │      (Continuous)      │  │
                 │                        │  │
  Internet ───►  │  [2] AdminJS Service   ├──┼──► [3] PostgreSQL
                 │     (Serverless Sleep) │  │        (Continuous)
                 └────────────────────────┘  │
                                             │
                       Private Database URL ─┘
```

| Service | Railway Root Dir | Builder / File | Availability | Replicas | Ceilings | Pool Size |
|---|---|---|---|---|---|---|
| **PostgreSQL** | N/A (Plugin) | Railway Postgres Template | Always On | 1 | 1 GB RAM, 1 vCPU | Managed |
| **Main API** | `/backend` | Config `/backend/railway.json`; `Dockerfile` | Always On | 1 | 512 MB RAM, 1 vCPU | Max 10 |
| **AdminJS** | `/backend/admin-service` | Config `/backend/admin-service/railway.json`; `Dockerfile` | Serverless Sleep | 1 | 512 MB RAM, 0.5 vCPU | Max 3 |

Set each Railway Root Directory and Config File independently; Config-as-Code does not automatically follow the root directory.

### Zero Fourth-Service Policy
- **No Redis:** AdminJS statistics use an in-process lazy cache with immediate mutation invalidation; sessions are stored in PostgreSQL (`connect-pg-simple`). The Main API uses in-process caching (`@nestjs/cache-manager`).
- **No PgBouncer:** Connection pools are bounded application-side (10 for API, 3 for AdminJS).
- **No Separate Worker / Scheduler:** Main API runs scheduled jobs in-process (`@nestjs/schedule`).

---

## 2. Environment Contracts & Private Networking

Both application services consume PostgreSQL strictly over **Railway private networking** (`DATABASE_URL` pointing to the private Postgres domain, e.g., `${{Postgres.DATABASE_PRIVATE_URL}}`).

### Main API (`pupzy-backend`)
| Variable | Required | Default / Example | Purpose |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Production mode |
| `PORT` | Yes | `3000` | HTTP port |
| `DATABASE_URL` | Yes | `${{Postgres.DATABASE_PRIVATE_URL}}` | Private Postgres connection string |
| `DB_POOL_MAX` | No | `10` | Maximum simultaneous Postgres connections |
| `PHONE_ENCRYPTION_KEY` | Yes | (32-byte base64 string) | AES-256-GCM phone encryption |
| `FIREBASE_PROJECT_ID` | Yes | (Firebase Project ID) | Firebase Admin authentication |
| `FIREBASE_CLIENT_EMAIL`| Yes | (Service Account Email) | Firebase Admin authentication |
| `FIREBASE_PRIVATE_KEY` | Yes | (Service Account PEM) | Firebase Admin authentication |
| `R2_ACCOUNT_ID` | Yes | (Cloudflare Account ID) | R2 Object Storage |
| `R2_ACCESS_KEY_ID` | Yes | (R2 Access Key ID) | R2 Object Storage |
| `R2_SECRET_ACCESS_KEY` | Yes | (R2 Secret Key) | R2 Object Storage |
| `R2_BUCKET_NAME` | Yes | `pupzy-media` | R2 Media Bucket |
| `R2_PUBLIC_URL` | Yes | `https://pub-xxx.r2.dev` | Public CDN URL for media |
| `ALLOWED_ORIGINS` | No | `""` (or comma-separated) | CORS allowed origins |
| `NODE_OPTIONS` | No | `--max-old-space-size=150` | V8 heap ceiling (150 MB) |

### AdminJS Service (`admin-service`)
| Variable | Required | Default / Example | Purpose |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Production mode |
| `PORT` | Yes | `4000` | HTTP port |
| `DATABASE_URL` | Yes | `${{Postgres.DATABASE_PRIVATE_URL}}` | Private Postgres connection string |
| `ADMIN_COOKIE_PASSWORD`| Yes | (≥ 32 chars) | AdminJS session cookie encryption |
| `ADMIN_SESSION_SECRET` | Yes | (≥ 32 chars) | Express session secret |
| `ADMIN_ALLOWED_IPS` | No | `""` (comma-separated IPs) | Optional IP allowlist for `/admin` |
| `NODE_OPTIONS` | No | `--max-old-space-size=256` | V8 heap ceiling (256 MB) |
| `REDIS_URL` | **Prohibited** | N/A | Must not be present |

---

## 3. Database Migration Ownership & Pre-Deploy Lifecycle

### Sole Ownership by Main API
- The **Main API is the sole database migration owner**.
- **AdminJS never runs migrations or custom SQL** at startup, during execution, or on serverless wake-up.

### Pre-Deploy Execution
Railway executes the migration operation via `deploy.preDeployCommand` in `railway.json` before activating new containers:
```bash
node dist/database/migrate.js
```

### Fail-Closed Deployment Safety
1. The migration runner applies ordered Drizzle migrations and then requires the repeatable `custom.sql` hook to succeed. Structural DDL belongs only in ordered migrations.
2. Any failure in migration SQL or custom SQL causes the process to exit with a non-zero code (`process.exit(1)`).
3. Railway detects the non-zero exit code, aborts the release, and keeps the current running deployment active.
4. The migration runner is completely idempotent: running against an already-migrated database succeeds with code 0 without duplicate errors or schema corruption.

The current `railway.json` format is scheduled for replacement by Railway Infrastructure as Code. Complete that migration before **2026-12-01**, with a staging verification target of **2026-11-01**.

---

## 4. Expand / Contract Schema Compatibility

Because the Main API and AdminJS deploy independently, and rolling releases may briefly run old and new versions concurrently, all database changes must follow the **Expand / Contract pattern**:

1. **Phase 1 — Expand (Additive Changes):**
   - Add new tables, nullable columns, columns with defaults, or new indexes.
   - Never rename or drop columns/tables currently in use.
   - Run pre-deploy migration with Phase 1 SQL.
2. **Phase 2 — Deploy Code:**
   - Deploy Main API and AdminJS versions that write to both new/old fields or transition to new fields.
3. **Phase 3 — Contract (Cleanup):**
   - Once all services are running the new code and no old replicas remain, deploy a follow-up migration to remove deprecated columns or temporary backwards-compatibility constraints.

---

## 5. Health Checks & Verification

- **Main API Health Check:** `GET /health` → Returns `200 OK` with `{"status":"ok", "info":{"app":{"status":"up"}}}`.
- **AdminJS Health Check:** `GET /health` → Returns `200 OK` with `{"ok":true}`.
- Both endpoints are unauthenticated and respond immediately without external cache dependencies.

---

## 6. Operational Controls & Architecture Decision

For complete operational runbooks, resource ceilings, cost alert thresholds ($4 alert, $10 hard shutdown boundary), backup retention schedules, launch checklists, seven-day metrics review procedures, and manual scaling policies (10,000-user review), refer to:
- **Hobby Launch Runbook:** [`docs/deployment/hobby-launch-runbook.md`](./hobby-launch-runbook.md)
- **Architecture Decision Record:** [`docs/adr/0001-three-service-railway-hobby-launch.md`](../adr/0001-three-service-railway-hobby-launch.md)
