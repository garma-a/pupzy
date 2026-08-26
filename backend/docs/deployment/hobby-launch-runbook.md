# Railway Hobby Launch & Operations Runbook

This runbook defines the operational controls, deployment specifications, cost governance, backup procedures, launch checklist, and scaling policy for launching the Pupzy backend on Railway Hobby.

---

## 1. Deployed Service Topology & Replicas

The launch infrastructure consists of **exactly three services** in one Railway project. No fourth service (such as Redis, PgBouncer, external workers, or background queue runners) is permitted.

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

### Service Inventory

| Service | Railway Root Dir | Builder / File | Availability Mode | Launch Replicas | Resource Ceilings | Pool Limits |
|---|---|---|---|---|---|---|
| **PostgreSQL** | N/A (Railway Plugin) | Managed Postgres | **Continuous** (Always On) | 1 | 1 GB RAM, 1 vCPU | Managed by Railway |
| **Main NestJS API** | `/backend` | `/backend/railway.json` → `Dockerfile` | **Continuous** (Always On) | **1** | 512 MB RAM, 1 vCPU | Max 10 connections (`DB_POOL_MAX`) |
| **AdminJS Service** | `/backend/admin-service` | `/backend/admin-service/railway.json` → `Dockerfile` | **Serverless Sleep** | **1** | 512 MB RAM, 0.5 vCPU | Max 3 (action/session) + Max 3 (SQL adapter) |

Railway's **Root Directory** and **Config File** settings are independent. Configure both absolute repository paths exactly as shown; the config file does not automatically follow the selected root.

### Continuous Availability vs. Sleep Policy
- **PostgreSQL:** Remains continuously running to maintain durable data availability.
- **Main NestJS API:** Remains continuously running with 1 replica to serve client mobile applications with zero cold-start latency.
- **AdminJS Service:** Configured with Railway Serverless sleep enabled. It automatically enters sleep state during periods of inactivity and wakes upon incoming HTTPS requests.

---

## 2. Resource Ceilings & Heap Sizing

### Resource Limits vs. Reserved Consumption
> **IMPORTANT:** Resource ceilings (RAM / vCPU limits) are **safety guardrails** configured in Railway to prevent runaway container consumption. They are **not reserved allocations** and do **not guarantee a $5 monthly bill**. Railway bills actual compute seconds (vCPU and RAM consumed).

### Initial Service Ceilings
1. **PostgreSQL:**
   - Memory Ceiling: **1 GB RAM**
   - CPU Ceiling: **1 vCPU**
2. **Main NestJS API:**
   - Memory Ceiling: **512 MB RAM**
   - CPU Ceiling: **1 vCPU**
   - V8 Heap Limit: Preserved at **150 MB** via `NODE_OPTIONS="--max-old-space-size=150"`. This ensures total RSS remains safely below container memory limits under high request volume.
3. **AdminJS Service:**
   - Memory Ceiling: **512 MB RAM**
   - CPU Ceiling: **0.5 vCPU**
   - V8 Heap Limit: **256 MB** via `NODE_OPTIONS="--max-old-space-size=256"`, leaving non-heap headroom within the 512 MB container ceiling. Validate RSS and GC behavior during the seven-day review.

---

## 3. Cost Controls, Alerting, & Hard Limits

### Cost Target vs. Hard Boundary Distinction
- **Launch Target:** Approximately **$5/month**, matching the $5 included compute credit provided with the Railway Hobby subscription.
- **Hard Spend Boundary:** Strictly enforced at **$10.00/month** hard compute limit.

```
$0 ────────────── $4 ─────────────── $7.50 ──────────── $9.00 ─────────── $10.00 (SHUTDOWN)
                   ▲                   ▲                  ▲                 ▲
            Custom Usage Alert   75% Hard Warning   90% Hard Warning   Hard Limit Shutdown
          (Email/Slack notice)   (Native Railway)   (Native Railway)   (All services offline)
```

### Cost Alerting Configuration
1. **Custom Compute-Usage Alert:**
   - Threshold: **$4.00**
   - Purpose: Provides early notification before the project exhausts the Hobby plan's $5 included compute credit.
   - Channel: Configured via Railway Workspace Settings -> Usage Alerts (Email / Webhook).
2. **Native Railway Hard-Limit Warnings:**
   - With a $10.00 hard limit, Railway natively generates automated notifications at:
     - **75% threshold (~$7.50)**: High usage warning.
     - **90% threshold (~$9.00)**: Critical impending shutdown warning.
     - **100% threshold ($10.00)**: Final shutdown notification.
   - **Policy:** Rely on these native alerts. No custom external webhook, cron, or polling automation is created solely for an exact $8 notification.
3. **Hard Limit Behavior & Outage Warning:**
   - > **CRITICAL WARNING:** Reaching the $10.00 hard compute limit causes Railway to **immediately take all workloads offline** (PostgreSQL, Main API, and AdminJS).
   - This intentional trade-off prioritizes absolute financial protection against runaway costs over continuous availability. Early alerts at $4, $7.50, and $9 provide operators sufficient runway to diagnose abnormal traffic or resource consumption before reaching shutdown.

---

## 4. AdminJS Serverless Mode & Cold Starts

### Serverless Configuration
- In Railway Service Settings for `admin-service`, toggle **Serverless** mode to **ON**.
- Set the sleep timeout to Railway's default inactive window (or 5 minutes).

### Operational Characteristics & Accepted Trade-offs
1. **Cold Start Latency:**
   - When AdminJS has been sleeping, the first request will experience a cold-start boot time of approximately 2 to 5 seconds.
   - This delay is accepted by operators for internal administrative tooling.
2. **Transient First-Request Failure:**
   - Occasionally during cold wake-up, the initial incoming HTTP connection may encounter a transient timeout or 502 Bad Gateway while the Node.js container boots and binds to port 4000.
   - Operators accept this possibility and should simply refresh the page if a transient 502 occurs during cold wake-up.
3. **Idle Connection Cleanup:**
   - To ensure the service can enter sleep, all database connection pools must release idle sockets:
     - SQL adapter (`Knex`): Configured with `min: 0`, `max: 3`, and `idleTimeoutMillis: 10000`.
     - Action/Session pool (`pg`): Configured with `max: 3` and `idleTimeoutMillis: 10000`.
     - Zero background intervals or statistics polling loops are active.
     - Expired sessions are pruned opportunistically on AdminJS requests, at most once per 15 minutes of active traffic; no pruning timer remains alive while the service is idle.
4. **Abuse and Cost Bounds:**
   - Login failures are bounded both per IP and per normalized account-plus-IP in process, and suspicious failures are logged without passwords.
   - Dashboard requests are limited to 30 per minute per IP; AdminJS resource mutations are limited to 60 per minute per IP.

---

## 5. PostgreSQL Volume Backup & Retention Policy

### Backup Strategy
- Backups utilize **Railway managed PostgreSQL volume snapshots**.
- **Daily Volume Backups:** Retained for **6 days**.
- **Weekly Volume Backups:** Retained for **1 month (30 days)**.

### No Auxiliary Backup Services
- The backup policy introduces **no separate backup worker container**, **no external cron process**, and **no point-in-time recovery (PITR) object storage bucket** at launch.
- Native volume snapshots provide scheduled snapshot restore capabilities without adding runtime compute cost or infrastructure complexity.

### Restore Verification Procedure
1. In Railway Dashboard, navigate to the PostgreSQL service -> **Backups** tab.
2. Select a target volume snapshot and click **Restore to New Service** or verify snapshot integrity.
3. Verify that tables, indexes, and extensions (`uuidv7`, `pgcrypto`) are present and consistent.

---

## 6. Launch Verification Checklist

Complete this checklist prior to public release:

```markdown
### Pre-Launch Railway Configuration Checklist
- [ ] Exactly 3 services exist in the Railway project: PostgreSQL, Main API, AdminJS.
- [ ] No Redis, PgBouncer, worker, or queue services are deployed.
- [ ] Main API Root Directory is `/backend` and Config File is `/backend/railway.json`.
- [ ] AdminJS Root Directory is `/backend/admin-service` and Config File is `/backend/admin-service/railway.json`.
- [ ] PostgreSQL is accessible only via Railway private networking (`DATABASE_PRIVATE_URL`).
- [ ] Replicas configured: exactly 1 replica for Main API, 1 replica for AdminJS.
- [ ] Resource Ceilings set in Railway:
      - PostgreSQL: 1 GB RAM / 1 vCPU
      - Main API: 512 MB RAM / 1 vCPU
      - AdminJS: 512 MB RAM / 0.5 vCPU
- [ ] Main API V8 old-space limit is active (`NODE_OPTIONS="--max-old-space-size=150"`).
- [ ] AdminJS V8 old-space limit is active (`NODE_OPTIONS="--max-old-space-size=256"`).
- [ ] AdminJS Serverless mode is toggled ON.
- [ ] Database pools configured: API max 10; AdminJS action/session max 3; AdminJS SQL min 0 / max 3.
- [ ] Cost Controls enabled in Railway Workspace Settings:
      - Custom compute usage alert set at $4.00.
      - Hard compute limit set at $10.00.
      - Native notifications at 75% ($7.50) and 90% ($9.00) enabled.
- [ ] PostgreSQL volume backups enabled: Daily retained for 6 days, Weekly retained for 1 month.
- [ ] Main API pre-deploy migration configured (`node dist/database/migrate.js`).
- [ ] AdminJS verified to run zero migrations at startup or wake-up.
- [ ] Online production dependency audits completed for both workspaces (`npm audit --omit=dev`); every advisory is upgraded, mitigated, or has a dated owner/risk acceptance. The AdminJS transitive `express-formidable` / Formidable 1.x chain requires explicit review until upstream removes it.
- [ ] Health check endpoints verified:
      - Main API: GET /health returns 200 OK `{"status":"ok"}`.
      - AdminJS: GET /health returns 200 OK `{"ok":true}`.
```

Do not mark an item complete from repository configuration alone. Record the verification date, operator, and a dashboard screenshot or deployment URL beside each item in the release record.

### Railway configuration retirement

The checked-in `railway.json` files are a launch control, not a durable platform contract. Railway's legacy Config-as-Code format must be migrated to Railway Infrastructure as Code before **2026-12-01**. Assign an owner and complete a staging deployment plus health/migration verification no later than **2026-11-01**.

---

## 7. Post-Launch Observability: Seven-Day Metrics Review

Following launch, the team must observe **seven continuous days** of operational metrics before adjusting any resource ceiling or connection pool:

### Review Metrics Checklist
1. **CPU Utilization:** Peak and sustained vCPU utilization across PostgreSQL, Main API, and AdminJS.
2. **Memory Utilization:** Peak RSS vs. container ceilings (512 MB) and V8 heap stability (150 MB).
3. **Database Connections:** Maximum simultaneous active and idle connections across both applications.
4. **Projected Monthly Spend:** Cumulative compute cost extrapolated over 30 days against the $5 target.
5. **AdminJS Cold Starts:** Wake-up latency, sleep/wake cycles per day, and any transient error rates.
6. **Railway Limit Warnings:** Verification that no $4 or native threshold alerts were unexpectedly triggered.

---

## 8. Manual Scaling Policy & 10,000 Registered Users Checkpoint

### Core Policy
- **No Automatic Plan Upgrades:** User registration growth will **never** automatically trigger a Railway plan upgrade from Hobby ($5) to Pro ($20 base).
- **No Automatic Horizontal Scaling:** Application replicas remain fixed at 1 until deliberate team review.

### 10,000-User Architecture Review
Upon reaching **10,000 registered users** in the database, the engineering team executes a formal manual architecture review across the following 11 dimensions:

1. **Projected Cost & Budget Runway:** Analyze actual compute consumption trends and evaluate the financial impact of transitioning to Railway Pro ($20/month base + compute).
2. **Service Saturation:** Evaluate whether Main API or PostgreSQL CPU/memory usage consistently exceeds 70% of assigned ceilings.
3. **Database & Query Performance:** Inspect PostgreSQL slow query logs, index efficiency, connection pool contention, and transaction latency.
4. **API Latency & Error Rates:** Review mobile client p95/p99 response times and 5xx error budgets under concurrent traffic.
5. **Moderation Workload:** Evaluate AdminJS daily active usage, moderation queue processing throughput, and whether Serverless sleep remains appropriate.
6. **Storage Growth:** Measure PostgreSQL disk volume consumption, index bloat, and Cloudflare R2 media storage growth.
7. **Backup & Restore Capability:** Review backup snapshot sizes, recovery point objectives (RPO), and test snapshot restore duration (RTO).
8. **Replica Needs:** Assess whether horizontal scaling (multiple API replicas) is necessary for redundancy or high concurrency.
9. **Log Retention & Observability:** Determine if native Railway log retention is sufficient or if external log drains (e.g. Better Stack / Datadog) are required.
10. **Team Collaboration & Access:** Assess whether multiple developer seats or advanced workspace RBAC available in Pro are required.
11. **Support Requirements:** Determine if project criticality necessitates Railway Pro's priority support SLA.

### Decision Rule for Railway Pro Upgrade
Upgrade to Railway Pro **only** through an explicit, unanimous team decision supported by documented evidence of resource saturation or required Pro features (e.g., higher memory ceilings, team seats, or custom SLAs).
