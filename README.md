# FlowSync

Real-time collaborative task management for small teams: a shared Kanban board that everyone edits at the same time. _Where teams flow together._

[![CI](https://github.com/temitopeagbola/FlowSync/actions/workflows/ci.yml/badge.svg)](https://github.com/temitopeagbola/FlowSync/actions/workflows/ci.yml)

Production site: **https://flowsync.temitopeagbola.com** (served by Netlify from `main`; see [Deployment](#deployment) for what has to be in place first). Click **Try the demo** to sign in as a guest, no sign-up needed.

## Overview

When several people move cards on the same board, most task tools either lock the board or let the last save silently overwrite the others. FlowSync keeps one shared board live for everyone: you see teammates' cursors and avatars, drag tasks between columns and chat next to the work. Every change shows on your screen immediately (an optimistic update), then the server, the single source of truth, confirms or corrects it. When two people drop cards into the same spot at the same moment, both cards land and everyone ends up with the same order. A React single-page app talks to a Node.js API over REST and Socket.io; the API stores everything in PostgreSQL and uses Redis to fan events out across API instances.

## Key features

- **Accounts and demo login.** Email + password accounts (bcrypt, JWT). **Try the demo** creates a guest with a friendly name (e.g. "Swift Otter") who joins a seeded demo workspace, so two browsers look like two people. The demo workspace is re-seeded on boot when older than `DEMO_RESET_HOURS`; guest accounts are deleted after 24 h.
- **Workspaces and boards.** Create workspaces, invite members by email (owner only) and create boards; new boards start with _To do / In progress / Done_.
- **Kanban and list views with drag-and-drop.** Move tasks within and across columns and reorder columns, with mouse, touch (press and hold) or keyboard (Space to pick up, arrows to move, Space to drop) and screen-reader announcements.
- **Task details.** Title, description, status, priority (low to urgent), assignee and due date, edited in a dialog.
- **Live cursors and presence.** Cursors with name tags and avatars of everyone on the board, cluster-wide across API instances.
- **Per-board team chat** with history, typing indicators, an unread badge and retry for failed sends.
- **Optimistic updates with server reconciliation** for every task and column change, including out-of-order and conflicting events.
- **Activity log** of creates, moves, edits, renames and deletes, live and paginated.
- **Dark mode** that follows the OS until you pick a side.
- **Latency badge** in the board header: how long your recent changes took to be confirmed, plus the network round trip.
- **Cold-start handling.** The app pings the API on load and shows a "Waking the server…" banner when a request or the socket connection is slow, retrying while a sleeping free-tier instance boots.

## Tech stack

| Layer            | Choice                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | React 19, Vite 7, TypeScript, Tailwind CSS 4, React Router 7, TanStack Query (REST data), Zustand (live board store), dnd-kit (drag-and-drop), socket.io-client, lucide |
| Backend          | Node.js 22, Express 5, Socket.io 4 with `@socket.io/redis-adapter` + ioredis, zod validation, pino logging, helmet, express-rate-limit                                  |
| Database         | PostgreSQL 16 via Prisma 6                                                                                                                                              |
| Realtime fan-out | Redis 7 (optional: without it the API uses Socket.io's in-memory adapter)                                                                                               |
| Auth             | Email + password (bcryptjs) → JWT bearer token, stored by the web app in `localStorage`                                                                                 |
| Hosting          | Netlify (web), Render free web service (API), Neon (Postgres), Upstash (Redis); Docker Compose for local                                                                |
| Tooling          | pnpm workspaces, strict TypeScript, ESLint, Prettier, Vitest, Playwright, tsup, GitHub Actions                                                                          |

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (Netlify)"]
    UI["React SPA<br/>Kanban · List · Chat · Activity"]
    Store["Sync engine<br/>confirmed state + pending mutations"]
    UI <--> Store
  end

  subgraph Render["API (Render)"]
    API["Node 22 · Express 5 · Socket.io 4"]
  end

  Store -- "REST: auth, workspaces,<br/>board snapshot, history" --> API
  Store <-- "Socket.io: mutations + acks,<br/>broadcasts, presence, cursors, chat" --> API
  API -- "Prisma" --> PG[("PostgreSQL (Neon)")]
  API <-- "@socket.io/redis-adapter<br/>pub/sub" --> Redis[("Redis (Upstash)")]
  More["More API instances"] <-.-> Redis
```

- **REST** (`/api/auth`, `/api/workspaces`, `/api/boards`) handles sign-in, workspaces, members, the board snapshot and paginated chat and activity history. `/health` is a cheap liveness check; `/health/ready` also checks Postgres and Redis.
- **Socket.io** carries everything board-scoped and live. A client joins one board room after an access check. Task and column mutations are request/ack events: the server validates the payload with the shared zod schema, checks the socket joined that board, runs the change in a Postgres transaction that also writes the activity row, acks the sender with the canonical row and broadcasts it to everyone else in the room.
- **Redis** makes broadcasts reach sockets on _any_ API instance and makes presence cluster-wide (`fetchSockets()` asks every instance).
- **Cursors** are the noisiest traffic. Clients send at most ~20 updates/s; the server keeps only the latest position per socket and flushes one volatile `cursor:batch` per board every 50 ms, so broadcast (and Redis PUBLISH) volume is bounded by boards × ticks rather than users × mouse moves.
- **`packages/shared`** holds the zod schemas (used by the API _and_ the forms), the typed Socket.io event maps, DTOs and the ordering logic, so a typo in an event name or payload is a compile error on both sides.

## Project structure

```text
apps/
  api/             Express + Socket.io API
    prisma/        schema + migrations (position columns use COLLATE "C")
    src/http/      Express app and REST routes
    src/realtime/  Socket.io server, handlers, presence, cursor batching, rate limits
    src/services/  domain logic: tasks, columns, boards, workspaces, activity, access checks
    src/demo/      demo seed, guest accounts, reset and pruning
    scripts/       latency benchmark
    test/          integration tests (Postgres, Redis)
  web/             React SPA
    src/sync/      sync engine (pure), board store (sockets), latency window
    src/board/     Kanban/list views, drag-and-drop hook, cursors, chat, activity, task dialog
    src/pages/     landing, workspaces, workspace, board
    e2e/           Playwright smoke test
packages/
  shared/          zod schemas, DTOs, socket event types, fractional indexing, ordering
docs/PLAN.md       architecture plan and decisions
.github/workflows/ CI
docker-compose.yml whole stack locally
render.yaml        Render blueprint (API)
netlify.toml       Netlify build (web)
```

## Getting started

### Prerequisites

- **Node.js 22** (`.nvmrc`; `engines.node` is `>=22`)
- **pnpm 10.28.0** (pinned in `package.json#packageManager`; run `corepack enable` to get it)
- **PostgreSQL 16** and **Redis 7**, or **Docker** with Compose to run them (Redis is optional for local development)

### Option A: everything in Docker (one command)

```bash
docker compose up --build
```

| Service  | Address                                                   |
| -------- | --------------------------------------------------------- |
| Web app  | http://localhost:8080                                     |
| API      | http://localhost:4000 (`/health`, `/health/ready`)        |
| Postgres | `localhost:5433`, user/password `postgres`, db `flowsync` |
| Redis    | `localhost:6380`                                          |

The API container applies migrations and seeds the demo workspace on boot. Open the app in two browsers (or a normal and a private window), click **Try the demo** in both and drag a card.

### Option B: run the apps on your machine

1. Install dependencies:

   ```bash
   corepack enable
   pnpm install
   ```

2. Create your env file and adjust the connection strings if needed:

   ```bash
   cp .env.example .env
   ```

3. Start Postgres and Redis, either your own installs on the default ports or the Compose services (then use ports `5433` and `6380` in `.env`):

   ```bash
   docker compose up -d postgres redis
   ```

4. Generate the Prisma client and apply migrations:

   ```bash
   pnpm db:generate
   pnpm db:deploy
   ```

5. Run the API (http://localhost:4000) and the web app (http://localhost:5173):

   ```bash
   pnpm dev
   ```

The API seeds the demo workspace on boot; `pnpm db:seed` re-creates it on demand.

### Environment variables

Every variable is listed with a comment in [`.env.example`](.env.example). Names and purpose (no values):

| Variable            | Used by          | Purpose                                                                                     |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | API              | `development`, `test` or `production`                                                       |
| `PORT`              | API              | HTTP + WebSocket port (default `4000`; Render sets it)                                      |
| `DATABASE_URL`      | API              | Postgres connection used by the app (on Neon, the pooled string)                            |
| `DIRECT_URL`        | API              | Direct Postgres connection used by `prisma migrate` (locally the same as `DATABASE_URL`)    |
| `REDIS_URL`         | API              | Redis for the Socket.io adapter; leave empty for the in-memory adapter (single instance)    |
| `JWT_SECRET`        | API              | Secret for signing tokens, 32+ characters; required in production                           |
| `CORS_ORIGIN`       | API              | Comma-separated origins allowed to call the API (REST and Socket.io); `*` wildcards allowed |
| `DEMO_ENABLED`      | API              | Enables "Try the demo" and the demo workspace seed                                          |
| `DEMO_RESET_HOURS`  | API              | Re-seed the demo workspace on boot when older than this many hours (`0` = never)            |
| `AUTH_RATE_LIMIT`   | API              | Max sign-in / sign-up / demo requests per IP per 15 minutes                                 |
| `LOG_LEVEL`         | API              | pino log level                                                                              |
| `VITE_API_URL`      | Web (build time) | Public URL of the API, compiled into the bundle                                             |
| `TEST_DATABASE_URL` | API tests        | Database for the integration tests (wiped by the run; its name must contain `test`)         |
| `TEST_REDIS_URL`    | API tests        | Optional Redis that enables the two-instance Redis adapter test                             |
| `E2E_DATABASE_URL`  | Playwright       | Database for the end-to-end run                                                             |
| `E2E_REDIS_URL`     | Playwright       | Optional Redis for the end-to-end run                                                       |

## Scripts

Run from the repository root:

| Command              | What it does                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`           | API (tsx watch) and web (Vite) in parallel                                                      |
| `pnpm build`         | Build every package (API with tsup, web with Vite)                                              |
| `pnpm lint`          | ESLint                                                                                          |
| `pnpm format:check`  | Prettier check (`pnpm format` rewrites files)                                                   |
| `pnpm typecheck`     | Strict `tsc` across the monorepo                                                                |
| `pnpm test`          | Unit and integration tests (needs Postgres; see [Testing](#testing))                            |
| `pnpm e2e`           | Playwright smoke test (starts the API and a production web build)                               |
| `pnpm db:generate`   | Generate the Prisma client                                                                      |
| `pnpm db:migrate`    | `prisma migrate dev` against the database in `.env` (create and apply migrations)               |
| `pnpm db:deploy`     | `prisma migrate deploy` (apply pending migrations only)                                         |
| `pnpm db:seed`       | Replace the demo workspace with a fresh copy                                                    |
| `pnpm bench:latency` | Update-latency benchmark against a running API (see [Update latency](#update-latency-measured)) |

## Testing

```bash
pnpm test   # unit + integration tests in every package
pnpm e2e    # Playwright end-to-end smoke test
```

| Suite                   | Where                                 | What it covers                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared unit tests       | `packages/shared/test`                | Fractional keys (reference vectors, a 2,000-insert randomised ordering check, key growth), `resolvePosition` conflict rules, schemas                                                                                                                                                                                                                                    |
| API integration tests   | `apps/api/test`                       | Auth, authorisation (404 for non-members), workspaces, members and boards, task ordering including **12 concurrent drops into one gap**, stale anchors, idempotent creates, columns, Socket.io (presence, broadcasts, no echo, access checks, validation, chat, cursor batching, board deletion), demo seeding/reset/advisory lock, guest pruning, rate limiter, config |
| Redis adapter test      | `apps/api/test/redis-adapter.test.ts` | Two API instances sharing Redis: cluster-wide presence and cross-instance broadcasts. Runs when `TEST_REDIS_URL` is set (always in CI)                                                                                                                                                                                                                                  |
| Web unit tests          | `apps/web/src/sync`                   | Sync engine: optimistic apply, ack adoption, rollback, rebase over remote changes, stale events, tombstones, resync; latency stats                                                                                                                                                                                                                                      |
| End-to-end (Playwright) | `apps/web/e2e`                        | Two guests on one board: presence, create, drag across columns, live sync to the other session, activity entry, chat, persistence after reload; a 375 px layout check                                                                                                                                                                                                   |

- The API tests use the database in `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/flowsync_test`). They apply migrations and truncate tables, so they refuse to run unless the database name contains `test`.
- `pnpm e2e` uses `E2E_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/flowsync_e2e`), starts the API on port 4100 and serves a production web build on port 4173.
- CI (`.github/workflows/ci.yml`) runs on every push and pull request: install → Prisma generate → lint → format check → typecheck → tests (with Postgres and Redis service containers) → Playwright, plus a second job that runs `docker compose build`.

## Deployment

| Piece    | Where                   | Config                                                                                                                                                                           |
| -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app  | Netlify                 | `netlify.toml`: builds from the repo root with `pnpm --filter @flowsync/web build`, publishes `apps/web/dist`, SPA fallback, cache and security headers                          |
| API      | Render free web service | `render.yaml` blueprint `flowsync-api` (Frankfurt): `pnpm install` + tsup build; the start command runs `prisma migrate deploy`, then the server, which seeds the demo workspace |
| Postgres | Neon                    | Pooled connection string as `DATABASE_URL`, direct one as `DIRECT_URL`                                                                                                           |
| Redis    | Upstash                 | TLS URL (`rediss://…`) as `REDIS_URL`                                                                                                                                            |

Order of setup:

1. **Neon:** create a project (the blueprint's region is Frankfurt, so pick AWS eu-central-1) and copy the pooled (`-pooler` host) and direct connection strings.
2. **Upstash:** create a Redis database in eu-central-1 and copy its `rediss://` URL.
3. **Render:** New → Blueprint → this repository. Paste `DATABASE_URL`, `DIRECT_URL` and `REDIS_URL` when prompted; `JWT_SECRET` is generated and `CORS_ORIGIN` is preset to `https://flowsync.temitopeagbola.com`. After the first deploy, `https://<service>.onrender.com/health/ready` should return `{"ok":true,"checks":{"db":"ok","redis":"ok"}}`.
4. **Netlify:** set `VITE_API_URL` to the Render URL. A production build without it fails on purpose (the live site keeps its previous version); deploy previews and branch deploys still build, with a warning, and point at `http://localhost:4000`. Then merge to `main` to deploy.

To let deploy previews call the API, add their origin to `CORS_ORIGIN`, e.g. `https://flowsync.temitopeagbola.com,https://deploy-preview-*--<netlify-site>.netlify.app`.

Render's free instances sleep when idle. The web app pings `/health` as soon as it loads so the server starts waking while the visitor reads the landing page, and each boot refreshes the demo workspace if it is older than `DEMO_RESET_HOURS`.

## How it works

### Ordering and conflicts (fractional indexing)

Storing an integer index for each card means a move into the middle of a column renumbers every card below it: many writes per drag, and two concurrent drags fight over the same rows. Instead, every task and column has a `position` string. Keys sort lexicographically and there is always room for a new key between two others:

```text
A   "a0"
B   "a1"          drop X between A and B  →  X = generateKeyBetween("a0", "a1") = "a0V"
C   "a2"          drop Y between A and X  →  Y = generateKeyBetween("a0", "a0V") = "a0G"
```

A move rewrites one row and never touches its siblings. The implementation (`packages/shared/src/fractional-index.ts`, after [David Greenspan's design](https://observablehq.com/@dgreensp/implementing-fractional-indexing)) uses base-62 digits and a variable-length integer part, so appending stays short (4 characters after 10,000 appends), and even 1,000 inserts into the same gap stay under 200 characters. Both are covered by tests.

Clients send _intent_, not keys: `{ taskId, toColumnId, afterId, beforeId }`. The client computes an optimistic key for instant feedback, and the server derives the real one:

1. `BEGIN`; lock the target column row (`SELECT … FOR UPDATE`). Every write that assigns a position in that column takes the same lock, so concurrent drops into one column run one after another and each sees the previous one's committed key.
2. Re-read the column's tasks and resolve the intent against the live order (`resolvePosition` in `packages/shared/src/ordering.ts`): directly after `afterId` if it is still there, else directly before `beforeId`, else the top or bottom the user aimed for.
3. Update the task (bumping its `version`), insert the activity row, `COMMIT`.

`UNIQUE (columnId, position)` is the safety net: a violation fails the transaction, which is retried against fresh data.

| Scenario                                                     | What happens                                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two people drop a card between A and B at the same moment    | The column lock serialises them; the second re-resolves "right after A" and lands between A and the first card. Both survive with distinct keys and the same order for everyone. |
| Someone drops "after A" just after A moved to another column | The server falls back to `beforeId`, then to top or bottom, instead of erroring.                                                                                                 |
| Two people move the same card at once                        | Last writer wins at the lock; versions tell every client which state is newer.                                                                                                   |
| Two people edit different fields of one card                 | The server writes only the fields in each patch, so both edits survive.                                                                                                          |

Postgres compares strings by collation: under `en_US.UTF-8`, `"a0" < "Zz"`, while JavaScript's byte order gives `"Zz" < "a0"`. The migration declares both position columns `COLLATE "C"` so the database orders keys exactly like the code.

### Optimistic updates and server reconciliation

The client store (`apps/web/src/sync/engine.ts`) keeps `confirmed` (what the server has said: snapshot, acks, broadcasts) and `pending` (local mutations not yet answered). What you see is `pending.reduce(applyMutation, confirmed)`.

```mermaid
sequenceDiagram
  participant A as Alice (browser)
  participant S as API
  participant DB as Postgres
  participant B as Bob (browser)
  A->>A: enqueue move → card moves immediately
  A->>S: task:move { taskId, toColumnId, afterId, beforeId, mutationId }
  S->>DB: BEGIN · lock column · resolve position · UPDATE (version+1) · INSERT activity · COMMIT
  S-->>B: task:upserted { task, mutationId } (via Redis if Bob is on another instance)
  S-->>A: ack { ok: true, data: task }
  A->>A: drop pending, adopt the canonical task
  B->>B: apply to confirmed, replay Bob's own pending edits on top
```

- **Ack:** the pending entry is dropped and the server's canonical row replaces the guess.
- **Rejection** (validation, permissions, deleted task, rate limit): dropping the pending entry is the rollback, and a toast explains why.
- **Remote changes while you have edits in flight** are applied to `confirmed` and your pending edits are replayed on top, so they are never clobbered.
- **Out-of-order events:** every task carries a `version`; older updates are ignored and deleted ids are tombstoned so a late update cannot resurrect them.
- **Reconnects** trigger a snapshot resync; events that arrive meanwhile are buffered and replayed. An ack that never arrives (10 s) rolls back and resyncs.
- **Task creation** uses client-generated UUIDs, so optimistic cards never need an id swap and a retried create is idempotent.

### Update latency, measured

`pnpm bench:latency` signs up two users on a fresh board (deleted afterwards). Client A moves one task back and forth between two columns, one move at a time, while client B listens. Both clients run in one process, so timestamps share one clock. **Move acked** is the time from A emitting `task:move` to A receiving the server's acknowledgement (validation, the column-locked transaction, the activity insert and the round trip); **move received** is the time until B sees the change.

Measured with the stack from `docker compose up` (API container, Postgres 16, Redis 7) on a 4-vCPU Linux VM (Intel Xeon 2.1 GHz), 300 moves after 20 warm-up moves, one move per 60 ms to stay under the per-socket rate limit:

| ms                                                       |  p50 |  p95 |  p99 |  max |
| -------------------------------------------------------- | ---: | ---: | ---: | ---: |
| Network round trip (`sync:ping`)                         |  0.5 |  0.9 |  1.8 |  1.8 |
| Move acked, sender                                       | 13.5 | 16.9 | 20.1 | 23.2 |
| Move received by a teammate, same API instance           | 13.3 | 16.5 | 19.8 | 23.1 |
| Move received by a teammate on a second instance (Redis) | 13.2 | 16.9 | 23.6 | 31.5 |

Nearly all of the ~13 ms is the Postgres transaction; Socket.io adds well under a millisecond, and crossing instances through Redis adds about 0.2 ms at the median. These are local numbers: in production, add your round trip to Render and Render↔Neon latency per statement. The latency badge in the board header shows your own live numbers. To benchmark a running API:

```bash
pnpm bench:latency                                   # API at http://localhost:4000
pnpm bench:latency --api https://<your-service>.onrender.com
pnpm bench:latency --api http://localhost:4000 --peer-api http://localhost:4001   # two instances, one Redis
```

Other flags: `--moves`, `--warmup`, `--interval` (ms between moves) and `--json`. Each run signs up two `bench-…@bench.flowsync.local` accounts.

## Security notes

- **Tokens in `localStorage`, not cookies:** the web app (Netlify) and API (Render) are on different sites, where third-party cookies get blocked. The trade-off is exposure to XSS; mitigations are React's escaping, no `dangerouslySetInnerHTML`, strict input validation and short-lived tokens (24 h for guests, 7 days for accounts).
- **Authorisation:** every REST route and socket event checks workspace membership and scopes queries to the board. Non-members get 404 rather than 403, so ids can't be probed, and a socket may only mutate the one board it joined.
- **Validation:** zod on every REST body, query, param and socket payload; JSON bodies are limited to 100 kB and socket frames to 64 kB.
- **Abuse limits:** per-IP limits on sign-in, sign-up and demo creation; per-socket token buckets for mutations, chat and typing events.
- **Demo isolation:** guests are workspace members (they can't invite people or delete boards), the demo workspace is re-seeded periodically and guests expire after 24 h.
- **Secrets:** none are committed; production refuses to start without `JWT_SECRET`, which the Render blueprint generates.
- **Passwords:** bcrypt (cost 10), with a constant-time path for unknown emails so login timing doesn't reveal which accounts exist.

## Limitations

- No member removal and no roles beyond owner and member.
- Text fields are last-writer-wins per field; two people typing in one description keep the last save.
- Key length is unbounded in theory; a background job could rebalance a column's keys with `generateNKeysBetween`.
- REST auth rate limits use an in-memory store, so they are per API instance.
- After a reconnect the client resyncs from a snapshot rather than replaying missed events.

## Contributing

There is no `CONTRIBUTING.md` yet. The flow:

1. Branch from `main`.
2. Make your change with tests; run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` locally.
3. Open a pull request against `main`. CI must be green (lint, format, typecheck, unit/integration tests, Playwright and the Docker build) before merging.

## License

All rights reserved. There is no open-source license file in this repository.
