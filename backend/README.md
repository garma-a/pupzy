# Pupzy Backend

> **Pupzy** is a pet-services marketplace connecting pet owners with trusted service providers.
> This repository contains the NestJS GraphQL backend that powers the Flutter mobile app.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 22 |
| **Framework** | NestJS 11 |
| **API** | GraphQL (Apollo + schema-first SDL) |
| **ORM** | Drizzle ORM |
| **Database** | PostgreSQL 15+ |
| **Auth** | Firebase Authentication (Google sign-in) |
| **Validation** | Zod (env + input) |
| **Language** | TypeScript 5 (strict mode) |

---

## Architecture Overview

```
Flutter App
    │  Firebase ID Token (Bearer)
    ▼
NestJS GraphQL API
    │
    ├── FirebaseAuthGuard    — verifies token, auto-creates user row on 1st login
    ├── GqlExceptionFilter   — sanitized, structured error responses
    ├── LoggingInterceptor   — request/response timing, correlation IDs
    │
    ├── UsersModule          — User identity, profile completion
    └── HealthModule         — GET /health for probes
    │
    ▼
PostgreSQL (via Drizzle ORM + node-postgres pool)
```

### Module Map

| Module | Scope | Responsibility |
|---|---|---|
| `ConfigModule` | Global | Env validation (Zod), typed `ConfigService` |
| `DatabaseModule` | Global | Drizzle ORM instance, pg connection pool |
| `FirebaseModule` | Global | Firebase Admin SDK init |
| `UsersModule` | Feature | User resolver, service, repository |
| `HealthModule` | Feature | `GET /health` readiness probe |

---

## Prerequisites

- **Node.js** ≥ 22 (`node --version`)
- **PostgreSQL** ≥ 15 running locally or remotely
- **Firebase project** with Google sign-in enabled
  ([Firebase Console](https://console.firebase.google.com))

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env-example .env
```

Edit `.env` and fill in:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Your local/remote PostgreSQL connection string |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Service Accounts → Generate key |
| `FIREBASE_PRIVATE_KEY` | Same JSON file as above |

> **Security note**: never commit `.env` or the Firebase service account JSON to git.
> Both are `.gitignore`-d.

### 3. Run database migrations

```bash
npx drizzle-kit migrate
```

This applies all SQL migrations from `drizzle/migrations/` to your PostgreSQL database.

### 4. Start the development server

```bash
npm run start:dev
```

Server starts on `http://localhost:3000` (or the `PORT` in your `.env`).

---

## API Reference

### Authentication

All GraphQL operations require a valid **Firebase ID token** in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

The token is obtained from the Firebase SDK in your Flutter app after Google sign-in.
On first login, the backend automatically creates a user row — no explicit signup mutation needed.

To get a token for testing, use the Firebase Auth REST API or the Firebase console's token tool.

### GraphQL Playground

In development, open [http://localhost:3000/graphql](http://localhost:3000/graphql).

Add the following HTTP header (replace with a real token):
```json
{ "Authorization": "Bearer <your-firebase-id-token>" }
```

### Queries

#### `me` — Get the current user

```graphql
query {
  me {
    id
    email
    fullName
    profilePictureUrl
    phoneNumber
    role
    cityId
    createdAt
    updatedAt
  }
}
```

### Mutations

#### `completeProfile` — Complete profile after first login

Called once after the user's first login to set their display name, phone number, and city.

```graphql
mutation CompleteProfile($input: CompleteProfileInput!) {
  completeProfile(input: $input) {
    id
    fullName
    phoneNumber
    cityId
  }
}
```

Variables:
```json
{
  "input": {
    "fullName": "Ahmed Girgis",
    "phoneNumber": "+201012345678",
    "cityId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Error Format

All errors follow a consistent structure:

```json
{
  "errors": [
    {
      "message": "Full name must be at least 2 characters",
      "extensions": {
        "code": "VALIDATION_ERROR"
      }
    }
  ]
}
```

| Extension code | Meaning |
|---|---|
| `UNAUTHENTICATED` | Missing or invalid Firebase token |
| `FORBIDDEN` | Authenticated but lacks permission |
| `NOT_FOUND` | Requested resource doesn't exist |
| `VALIDATION_ERROR` | Input failed business-logic validation |
| `BAD_USER_INPUT` | Malformed request |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

## Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "info": { "app": { "status": "up", "version": "0.0.1" } }
}
```

Used by load balancers and Kubernetes liveness/readiness probes.

---

## Development Commands

```bash
# Start in watch mode (recommended for development)
npm run start:dev

# Run unit tests
npm run test

# Run unit tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Lint and auto-fix
npm run lint

# Format code
npm run format

# Generate new migration from schema changes
npx drizzle-kit generate

# Apply pending migrations
npx drizzle-kit migrate

# Open Drizzle Studio (DB GUI)
npx drizzle-kit studio
```

---

## Project Structure

```
src/
├── app.module.ts                   # Root module — wires everything together
├── main.ts                         # Bootstrap: CORS, helmet, shutdown hooks
│
├── auth/
│   ├── firebase.module.ts          # Firebase Admin SDK provider
│   ├── firebase.guard.ts           # Global auth guard (verifies Bearer token)
│   └── current-user.decorator.ts  # @CurrentUser() param decorator
│
├── common/
│   ├── errors/
│   │   └── app.errors.ts           # Domain error classes (NotFoundError, etc.)
│   ├── filters/
│   │   └── gql-exception.filter.ts # Global exception filter
│   ├── interceptors/
│   │   └── logging.interceptor.ts  # Request logging + correlation IDs
│   └── types/
│       └── gql-context.type.ts     # Typed GraphQL context interface
│
├── config/
│   └── env.config.ts               # Zod env schema + validateEnv()
│
├── database/
│   ├── database.module.ts          # DB module with graceful shutdown
│   ├── database.provider.ts        # Drizzle ORM + pg pool
│   └── schema/
│       ├── index.ts                # Re-exports all schemas
│       └── users.schema.ts         # Users table + indexes
│
├── health/
│   ├── health.module.ts            # Health module
│   └── health.controller.ts       # GET /health endpoint
│
└── users/
    ├── dto/
    │   └── complete-profile.input.ts  # Zod-validated input DTO
    ├── users.graphql               # SDL type definitions
    ├── users.module.ts             # UsersModule DI wiring
    ├── users.resolver.ts           # GraphQL resolver
    ├── users.service.ts            # Business logic
    └── users.repository.ts        # Database access layer
```

---

## Security Model

| Concern | Solution |
|---|---|
| **Authentication** | Firebase ID tokens, verified server-side on every request |
| **Authorization** | Global `FirebaseAuthGuard`; `@Public()` to opt out |
| **Secrets** | Environment variables; `.env` + Firebase JSON in `.gitignore` |
| **HTTP headers** | `helmet` middleware (CSP, HSTS, X-Frame-Options) |
| **CORS** | Explicit allow-list via `ALLOWED_ORIGINS` env var |
| **Rate limiting** | `@nestjs/throttler` — 100 req/60s per IP by default |
| **Input validation** | Zod schemas on all mutation inputs |
| **Error messages** | Sanitized in production — no stack traces to clients |
| **Introspection** | Disabled in production |
| **Query depth** | Limited to 10 levels via `graphql-depth-limit` |

---

## Performance Model

| Concern | Solution |
|---|---|
| **Connection pooling** | pg pool (max 20 connections, configurable) |
| **Auth guard caching** | Firebase token cached until expiry; user row cached 60s |
| **Database indexes** | `firebase_uid` (unique), `email` (unique), `city_id`, `created_at` |
| **Graceful shutdown** | Pool closed cleanly on SIGTERM / SIGINT |

---

## Flutter Integration

The Flutter app authenticates with Firebase (Google sign-in), then passes the Firebase ID token to this backend:

```dart
// Get token after Google sign-in
final user = FirebaseAuth.instance.currentUser;
final token = await user?.getIdToken();

// Use in GraphQL client (e.g., graphql_flutter)
final authLink = AuthLink(
  getToken: () async => 'Bearer $token',
);
```

The backend handles user creation automatically — no separate signup step needed.

---

## License

Private — All rights reserved © Pupzy
