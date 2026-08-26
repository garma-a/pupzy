# 0001: Three-Service Railway Hobby Launch Architecture and Cost Controls

- **Status:** Accepted
- **Date:** 2026-08-25
- **Context:** Launching the Pupzy backend on Railway Hobby with a predictable, low-cost operating baseline (~$5/month target) while preserving full administrative and moderation capabilities.

---

## Decision

We accept a **three-service topology** as the sole deployed infrastructure on Railway:
1. **PostgreSQL** (Managed Railway database, continuously available)
2. **Main NestJS API** (Single replica, continuously available)
3. **AdminJS Service** (Single replica, Railway Serverless sleep enabled)

All fourth-service infrastructure—including Redis, external cache clusters, PgBouncer sidecars, dedicated background workers, and standalone schedulers—is explicitly prohibited for this launch.

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

### Key Architectural Choices

1. **Process-Local AdminJS Statistics Cache:**
   - Statistics computation is lazy and on-demand (triggered exclusively by dashboard HTTP requests).
   - Cached statistics expire after 120 seconds (TTL).
   - "Refresh now" bypasses the cached value, queries PostgreSQL immediately, and replaces the cache.
   - Successful state-changing actions performed in AdminJS (built-in CRUD and custom moderation actions) immediately invalidate the cache before completing.
   - Invalidation version guards prevent pre-mutation in-flight computations from repopulating the cache with stale data.
   - Cache loss during sleep, restart, or deployment is normal and harmless; PostgreSQL is always the source of truth.

2. **PostgreSQL Session Storage:**
   - AdminJS sessions are stored in PostgreSQL (`connect-pg-simple` table `admin_sessions`) with a dedicated connection pool capped at 3 connections.
   - No external Redis or session-store service is used.

3. **Railway Serverless Sleep for AdminJS:**
   - The AdminJS service enables Railway Serverless mode to sleep upon inactivity, conserving compute hours.
   - Idle database connections are released (SQL adapter pool min: 0, max: 3, 10s idle timeout; session pool max: 3).
   - We accept the operational trade-offs of Serverless sleep for internal administrative tooling: a cold-start delay of several seconds upon initial wake-up and potential transient first-request failures (e.g. 502 timeout during container boot).
   - PostgreSQL and the Main API remain continuously available to ensure uninterrupted client mobile API traffic.

4. **Cost Posture & Bounded Risk:**
   - The Railway Hobby plan ($5/month base subscription) includes the first $5 of compute usage. We target approximately $5/month for initial operations.
   - Resource ceilings (Main API: 512 MB RAM / 1 vCPU; AdminJS: 512 MB RAM / 0.5 vCPU; PostgreSQL: 1 GB RAM / 1 vCPU) are safety limits against runaway compute, not reserved allocations, and do not guarantee a $5 bill.
   - We configure a custom compute-usage alert near $4 to notify the team before exceeding included Hobby usage.
   - We enforce a hard compute limit of $10 in Railway workspace settings. When reached, Railway takes all workloads offline to strictly prevent uncapped financial exposure.
   - We rely on Railway's native hard-limit warning notifications at 75% ($7.50), 90% ($9.00), and 100% ($10.00 shutdown). We deliberately reject custom external alert automation solely to produce an exact $8 notification.
   - The launch contract formally distinguishes the ~$5 launch cost target from the separately enforced $10 hard shutdown boundary.

5. **PostgreSQL Volume Backup Policy:**
   - Volume backups use native Railway PostgreSQL automated volume snapshots.
   - Daily volume backups are retained for 6 days.
   - Weekly volume backups are retained for 1 month (30 days).
   - No separate backup worker container, external cron process, or point-in-time recovery (PITR) bucket is introduced at launch.

6. **Manual Scaling & 10,000-User Checkpoint:**
   - The application does not scale horizontally or upgrade plans automatically.
   - The team will review seven continuous days of operational metrics (CPU, memory, DB connections, projected cost, cold starts, warning triggers) before adjusting any resource limit.
   - Reaching 10,000 registered users serves as an explicit, documented manual architecture review checkpoint evaluating:
     1. Projected cost & budget runway
     2. Service saturation (CPU / memory headroom)
     3. Database and query behavior (connection saturation, query latency)
     4. API latency and error rates
     5. Moderation workload and AdminJS wake frequency
     6. Storage growth (DB volume and media)
     7. Backup and restore capabilities
     8. Replica needs for API throughput
     9. Log retention and observability requirements
     10. Workspace collaboration and RBAC needs
     11. Support SLA requirements
   - Upgrading to Railway Pro ($20/month minimum base) requires an explicit team decision based on measured saturation or specific required platform capabilities.

7. **Domain Glossary Rationale:**
   - General infrastructure, hosting, and caching terminology (such as Railway, Hobby, Serverless, TTL, PgBouncer, Redis, replicas, vCPU, and V8 heap limits) does not require a Pupzy domain glossary entry in `CONTEXT.md`.
   - `CONTEXT.md` is reserved exclusively for Pupzy business and product domain language (e.g. Pets, Posts, Adoptions, Mating, Rescues, Moderation).

8. **Ban Revocation SLA:**
   - Administrative-session revocation is immediate when an administrator's password, role, or active status changes.
   - For mobile API users, the existing process-local user cache means a newly issued ban can take up to **60 seconds** to affect an already cached authenticated user. Product and operations explicitly accept this launch SLA; emergency-ban procedures must allow for that maximum window.

---

## Consequences

- **Positive:**
  - Operating costs remain predictable and bounded within the Hobby tier.
  - Zero auxiliary services reduce architectural complexity and failure modes.
  - Hard limit at $10 prevents unbounded billing surprises.
  - Clear, auditable runbook and verification checklist enable reliable operations.

- **Trade-offs & Mitigations:**
  - AdminJS cold starts: Operators accept a brief wait when accessing the dashboard after idle periods.
  - Reaching the $10 hard limit suspends services: Accepted as the ultimate safeguard against run-away spending; early warning alerts at $4, $7.50, and $9 provide actionable notice to intervene before shutdown.
  - No PITR at launch: Native daily/weekly volume snapshots provide sufficient recovery points for launch scale without the operational cost of dedicated backup pipelines.
