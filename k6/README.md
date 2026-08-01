# Pupzy — k6 Performance Test Suite

Performance tests for the Pupzy NestJS/GraphQL backend using [k6](https://k6.io/).

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| k6 | ≥ 0.50 | `brew install k6` / `snap install k6` |
| Node.js | ≥ 22 | (same as backend) |
| Docker | any | For monitoring stack |
| psql | any | For fixture export |

---

## Quick Start

### 1. Install token-generation dependencies

```bash
cd ../backend
npm install firebase-admin node-fetch dotenv
```

### 2. Set environment variables

Copy `backend/.env-example` and ensure these are set:

```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
FIREBASE_WEB_API_KEY=AIzaSy...   # from Firebase Console → Project settings → General
```

### 3. Generate Firebase tokens

```bash
# From the repo root
node backend/scripts/generate-tokens.mjs --count=50 --out=k6/tokens.json
```

Tokens expire in **1 hour**. Re-run before any test that exceeds 45 minutes.

### 4. Export fixtures from test DB

```bash
psql $TEST_DATABASE_URL -t -A -f k6/sql/fixtures.sql > k6/fixtures.json
```

> **Note:** The test DB must be seeded with at least 1,000 RESCUE/ADOPTION posts
> and 50 users with completed profiles before running tests.

### 5. Run the smoke test first

```bash
k6 run --env BASE_URL=https://your-test-instance.railway.app k6/smoke.js
```

A passing smoke test (0 % errors, all checks green) is a prerequisite for every other test.

---

## Test Execution Order

```bash
BASE_URL=https://your-test-instance.railway.app

# 1. Smoke — always first
k6 run --env BASE_URL=$BASE_URL k6/smoke.js

# 2. PostGIS isolation — understand the baseline cost before load testing
k6 run --env BASE_URL=$BASE_URL k6/feeds-deep.js

# 3. Load — realistic production traffic
k6 run --env BASE_URL=$BASE_URL \
       --out json=results/load.json \
       k6/load.js

# 4. Stress — find the breaking point
k6 run --env BASE_URL=$BASE_URL \
       --out json=results/stress.json \
       k6/stress.js

# 5. Spike — burst resilience
k6 run --env BASE_URL=$BASE_URL k6/spike.js

# 6. Soak — memory / cron (start monitoring stack first)
docker compose -f k6/docker-compose.yml up -d
k6 run --env BASE_URL=$BASE_URL \
       --out influxdb=http://localhost:8086/k6 \
       k6/soak.js

# 7. Pagination correctness
k6 run --env BASE_URL=$BASE_URL k6/pagination.js
```

---

## Test Environment Requirements

Deploy a **dedicated Railway instance** (never test against production) with:

| Env Var | Value | Reason |
|---|---|---|
| `THROTTLE_LIMIT` | `999999` | Disable effective rate limiting |
| `THROTTLE_TTL_MS` | `60000` | |
| `DB_POOL_MAX` | `20` | Keep realistic (same as production) |
| `NODE_ENV` | `production` | Disable playground, enable error masking |

---

## File Structure

```
k6/
├── lib/
│   ├── config.js        ← SLA thresholds + BASE_URL
│   ├── gql.js           ← GraphQL POST helper
│   ├── auth.js          ← Token pool (SharedArray)
│   └── fixtures.js      ← Fixture loader + random pickers
├── queries/
│   ├── cities.js        ← cities query
│   ├── me.js            ← me query
│   ├── feeds.js         ← helpFeed, adoptFeed, marketFeed, homeFeed
│   ├── post-detail.js   ← post + type-specific detail queries
│   └── mutations.js     ← recordView, toggleUpvote, toggleSave, createPost
├── sql/
│   └── fixtures.sql     ← Generates fixtures.json from test DB
├── smoke.js             ← 1 VU, 2 min
├── load.js              ← Ramped 0→50 VUs, 12 min
├── stress.js            ← Stepped 20→250 VUs, find breaking point
├── spike.js             ← 0→300 VUs in 10 s
├── soak.js              ← 30 VUs, 30 min
├── feeds-deep.js        ← PostGIS isolation (geo vs no-geo)
├── pagination.js        ← Cursor chain p1→p2→p3
├── docker-compose.yml   ← InfluxDB + Grafana monitoring
├── fixtures.json        ← GENERATED (gitignored)
├── tokens.json          ← GENERATED (gitignored)
└── results/             ← GENERATED (gitignored)
```

---

## SLA Thresholds (Pass/Fail)

| Endpoint | p50 | p95 | p99 |
|---|---|---|---|
| `GET /health` | — | — | < 50 ms |
| `cities` | — | — | < 200 ms |
| `me` | — | < 150 ms | < 300 ms |
| `helpFeed` (no geo) | < 400 ms | < 800 ms | < 1500 ms |
| `helpFeed` (geo) | < 600 ms | < 1200 ms | < 2000 ms |
| `adoptFeed` / `marketFeed` | < 350 ms | < 700 ms | < 1200 ms |
| `homeFeed` | < 400 ms | < 800 ms | < 1500 ms |
| `post(id)` | — | < 200 ms | < 400 ms |
| `postDetail` | — | < 150 ms | < 300 ms |
| `recordView` | — | < 100 ms | — |
| `toggleUpvote` / `toggleSave` | — | < 400 ms | < 800 ms |
| `createPost` | — | < 800 ms | < 1500 ms |

Overall error rate must stay below **1 %** during load tests.

---

## Soak Test: Grafana Setup

1. Start the monitoring stack: `docker compose -f k6/docker-compose.yml up -d`
2. Open Grafana: http://localhost:3001
3. Go to **Dashboards → Import → ID: 2587** (official k6 Grafana dashboard)
4. Select the `InfluxDB` data source and import
5. Run the soak test with `--out influxdb=http://localhost:8086/k6`
6. Watch the **p99 over time** panel — a flat line is healthy; a rising line indicates a memory leak or GC pressure

---

## Known Bottlenecks

| Bottleneck | Expected Threshold | Symptom |
|---|---|---|
| DB pool (`DB_POOL_MAX=20`) | Saturates at ~80–100 concurrent VUs | p99 jumps 10× |
| PostGIS `ST_DWithin` | 2–3× slower than no-geo | `feed_geo_latency p95 > 1200 ms` → check GIST index |
| `toggleUpvote` (5-query txn) | Degrades at ~30–50 concurrent writers | p99 > 800 ms |
| `ViewFlushCron` (3 min) | Periodic p99 spikes of 100–500 ms | Visible in Grafana at t+3m, t+6m, ... |
