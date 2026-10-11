# FlowSync

**Where teams flow together.** Real-time collaborative task management.

[![CI](https://github.com/isaacpyo/flowsync/actions/workflows/ci.yml/badge.svg)](https://github.com/isaacpyo/flowsync/actions/workflows/ci.yml)

**Live demo: https://flowsync.temitopeagbola.com** (click **Try the demo**, no sign-up)

FlowSync is a shared Kanban board where a whole team works on the same board at the same
time. You see teammates' cursors and avatars live, drag tasks between columns, and chat
next to the work. Your changes appear instantly: they are applied optimistically, then
confirmed or corrected by the server, which is the single source of truth. When two
people drop cards into the same spot at the same moment, both cards land and the order
is the same for everyone. Under the hood: React + Vite on Netlify, a Node.js + Socket.io
API on Render, Postgres (Neon) through Prisma, and Redis (Upstash) fanning out events
across API instances.

> The API runs on Render's free tier, which sleeps when idle. The first visit can take
> 30–60 s to wake it; the app shows a "Waking the server…" banner while it does.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [How ordering conflicts are resolved (fractional indexing)](#how-ordering-conflicts-are-resolved-fractional-indexing)
- [Optimistic updates and server reconciliation](#optimistic-updates-and-server-reconciliation)
- [Update latency, measured](#update-latency-measured)
- [Local setup](#local-setup)
- [Testing](#testing)
- [Deploy](#deploy)
- [Environment variables](#environment-variables)
- [Stack and substitutions](#stack-and-substitutions)
- [Security notes and trade-offs](#security-notes-and-trade-offs)
- [Project structure](#project-structure)
- [Limitations and next steps](#limitations-and-next-steps)

## Features

- **Accounts and demo login.** Email + password accounts (bcrypt, JWT). **Try the demo**
  creates a guest with a friendly name (e.g. "Swift Otter") who joins a seeded demo team,
  so two browsers look like two people.
- **Workspaces and boards.** Create workspaces, invite members by email (owner only),
  create boards; new boards start with _To do / In progress / Done_.
- **Kanban and list views with drag-and-drop.** Move tasks within and across columns,
  reorder columns. Works with mouse, touch (press and hold) and keyboard (Space to pick
  up, arrows, Space to drop), with screen-reader announcements.
- **Live cursors and presence.** Cursors with name tags, avatars of everyone on the board
  (cluster-wide, across API instances).
- **Per-board team chat** with history, typing indicators, unread badge and retry for
  failed sends.
- **Optimistic updates with server reconciliation** for every task and column change,
  including correct handling of out-of-order and conflicting events.
- **Activity log**: every create, move, edit, rename and delete, live and paginated.
- **Dark mode** that follows the OS until you pick a side.
- **Latency badge** in the board header: the measured time for your last changes to be
  confirmed by the server, plus the raw network round trip.
- **Production details:** loading skeletons, empty and error states, responsive down to
  375 px, focus styles, labelled controls, rate limiting, input validation on every REST
  body and socket payload.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (Netlify CDN)"]
    UI["React SPA<br/>Kanban · List · Chat · Activity"]
    Store["Sync engine<br/>confirmed state + pending mutations"]
    UI <--> Store
  end

  subgraph Render["Render free web service"]
    API["Node 22 · Express 5 · Socket.io 4<br/>zod validation · services"]
  end

  Store -- "REST: auth, workspaces,<br/>board snapshot, history" --> API
  Store <-- "Socket.io: mutations + acks,<br/>broadcasts, presence, cursors, chat" --> API
  API -- "Prisma (pooled)" --> PG[("Neon Postgres")]
  API <-- "@socket.io/redis-adapter<br/>pub/sub" --> Redis[("Upstash Redis")]
  More["More API instances"] <-.-> Redis
```

- **REST** handles request/response work: sign-in, workspaces, members, the board snapshot,
  and paginated chat and activity history.
- **Socket.io** carries everything board-scoped and live. A client joins one board room after
  an access check. Task and column mutations are request/ack events: the server validates
  the payload with the shared zod schema, checks that the socket joined that board, runs
  the change in a Postgres transaction that also writes the activity row, acks the sender
  with the canonical row, and broadcasts it to everyone else in the room.
- **Redis** (Socket.io Redis adapter) makes broadcasts reach sockets connected to _any_ API
  instance, and makes presence cluster-wide (`fetchSockets()` asks every instance). Without
  `REDIS_URL` the in-memory adapter is used, which is fine for one instance.
- **Cursors** are the noisiest traffic. Clients send at most ~20 updates/s; the server keeps
  only the latest position per socket and flushes **one** volatile `cursor:batch` per board
  every 50 ms. Broadcast count (and so Redis PUBLISH count, which Upstash's free tier meters)
  is bounded by boards × ticks, not users × mouse moves, and is zero when nobody moves.
- **Presence** is derived from who is in the room rather than stored, so it cannot drift.

Shared code lives in `packages/shared`: zod schemas (used by the API _and_ the forms), the
typed Socket.io event maps (a typo in an event name or payload is a compile error on both
sides), DTOs, and the ordering logic below.

## How ordering conflicts are resolved (fractional indexing)

### The problem

A Kanban column is an ordered list that several people edit at once. Storing an integer
index means a move into the middle renumbers every card below it: many writes per drag,
and two concurrent drags fight over the same rows.

### Fractional index keys

Every task (and column) has a `position` string. Keys sort lexicographically, and there is
always room for a new key between any two keys:

```text
A   "a0"
B   "a1"          drop X between A and B  →  X = generateKeyBetween("a0", "a1") = "a0V"
C   "a2"          drop Y between A and X  →  Y = generateKeyBetween("a0", "a0V") = "a0G"
```

A move rewrites **one row** (the moved task) and never touches its siblings. The
implementation (`packages/shared/src/fractional-index.ts`, after
[David Greenspan's design](https://observablehq.com/@dgreensp/implementing-fractional-indexing))
uses base-62 digits and a variable-length integer part, so appending stays short: after
10,000 appends the key is still 4 characters. Repeatedly inserting into the _same_ gap
(the worst case) grows keys slowly: 1,000 inserts in one spot stay under 200 characters.
Both properties are covered by tests.

### Clients send intent, not keys

When you drop a card, the client sends _where you meant to put it_:

```ts
{ taskId, toColumnId, afterId: "A", beforeId: "B" }   // "between A and B"
```

The client uses that intent to compute an optimistic key for instant feedback, but the
server derives the real key itself:

1. `BEGIN`; lock the target column row: `SELECT … FROM "Column" WHERE id = $1 FOR UPDATE`.
   Every write that assigns a position in that column takes the same lock, so concurrent
   drops into one column run one after another, and each one sees the previous one's
   committed key. (Drops into different columns still run in parallel.)
2. Re-read the column's current tasks and resolve the intent against the **live** order
   (`resolvePosition` in `packages/shared/src/ordering.ts`):
   - `afterId` still in the column → place directly after it (between it and its _current_
     successor);
   - otherwise `beforeId` still there → place directly before it;
   - neither anchor left → top if the user dropped at the top, otherwise bottom.
3. Update the task (and bump its `version`), insert the activity row, `COMMIT`.

`UNIQUE (columnId, position)` is the safety net: if the invariant were ever broken, the
transaction fails with a unique violation and is retried against fresh data.

### Conflict scenarios

| Scenario                                                                  | What happens                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alice and Bob both drop a card between A and B at the same moment         | The column lock serialises them. Alice's lands between A and B; Bob's re-resolves "right after A" and lands between A and Alice's card. Both survive, no duplicate keys, and everyone converges on the same order. A test fires 12 concurrent drops into one gap and asserts 14 distinct, correctly ordered keys. |
| Bob drops "after A", but Alice moved A to another column a moment earlier | The `afterId` anchor is gone, so the server falls back to `beforeId`, then to top/bottom. Bob's card still lands where it makes sense instead of erroring.                                                                                                                                                        |
| Alice and Bob move the _same_ card at once                                | Last writer wins at the lock; the version increments twice. The client that lost gets the final state from the broadcast (higher version) and its ack, so both screens agree.                                                                                                                                     |
| Two people edit different fields of the same card                         | The server writes only the fields in each patch, so both edits survive (field-level last-writer-wins).                                                                                                                                                                                                            |

### A collation gotcha

Postgres compares strings by the database collation. Under `en_US.UTF-8`, `"a0" < "Zz"`; in
JavaScript (byte order), `"Zz" < "a0"`. Fractional keys use both cases, so a locale-aware
`ORDER BY position` would scramble columns. The migration declares both position columns
`COLLATE "C"` (byte-wise, same as JS), and the server also sorts with the same comparator
in code. Prisma has no schema syntax for column collation, so it lives in the migration SQL;
`prisma migrate diff` confirms no drift.

## Optimistic updates and server reconciliation

The client store (`apps/web/src/sync/engine.ts`) keeps:

- **`confirmed`**: what the server has told us (snapshot, acks, broadcasts);
- **`pending`**: local mutations the server hasn't answered yet, in order.

What you see is `view = pending.reduce(applyMutation, confirmed)`. It is the same idea
games and tools like Replicache use: rebase local, unconfirmed changes on top of
authoritative state.

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

- **Ack**: the pending entry is removed and the server's canonical row replaces the guess.
  If someone else got the slot first, the card settles where the server put it.
- **Rejection** (validation, permissions, task deleted, rate limit): the pending entry is
  dropped, which _is_ the rollback, and a toast explains why.
- **Remote change while you have edits in flight**: applied to `confirmed`; your pending
  edits are replayed on top, so they are never clobbered and never lost.
- **Out-of-order events** (acks vs broadcasts, several instances): every task carries a
  `version`; anything older than what we have is ignored. Deleted ids are tombstoned so a
  late update cannot resurrect them.
- **Reconnects**: every (re)join triggers a snapshot resync. Events that arrive while the
  snapshot is in flight are buffered and replayed on top of it (idempotent thanks to
  versions), so nothing is missed. An ack that never arrives (10 s) rolls back and resyncs.
- **Task creation** uses client-generated UUIDs, so optimistic cards never need an id swap,
  and a retried create is idempotent on the server.

All of this is pure TypeScript with unit tests (`engine.test.ts`), independent of React and
sockets.

## Update latency, measured

`pnpm bench:latency` signs up two users on a fresh board (deleted afterwards). Client A
moves one task back and forth between two columns, one move at a time; client B only
listens. Both clients run in one process, so all timestamps share one clock.

- **move acked**: A emits `task:move` → A has the server's acknowledgement. This includes
  validation, the column-locked transaction, the activity insert and the network round trip.
  It is the time until an optimistic change is _confirmed_. (On screen the change shows in
  the same frame; this is the time until it becomes final.)
- **move broadcast**: A emits → B receives the change, i.e. how long until a teammate sees it.

Measured with the full stack from `docker compose up` (API container, Postgres 16, Redis 7)
on a 4-vCPU Linux VM (Intel Xeon 2.1 GHz), 300 moves after 20 warm-up moves, paced at one
move per 60 ms to stay under the per-socket rate limit:

| ms                                                                   |  p50 |  p95 |  p99 |  max |
| -------------------------------------------------------------------- | ---: | ---: | ---: | ---: |
| Network round trip (`sync:ping`)                                     |  0.5 |  0.9 |  1.8 |  1.8 |
| Move acked, sender                                                   | 13.5 | 16.9 | 20.1 | 23.2 |
| Move received by a teammate, **same** API instance                   | 13.3 | 16.5 | 19.8 | 23.1 |
| Move received by a teammate on a **second** API instance (via Redis) | 13.2 | 16.9 | 23.6 | 31.5 |

Takeaways:

- Nearly all of the ~13 ms is the Postgres transaction (lock, read siblings, update,
  activity insert: around eight sequential round trips through Prisma's interactive transaction). Socket.io
  itself adds well under a millisecond.
- The broadcast leaves before the ack, so teammates see a change about as soon as its
  author gets confirmation.
- Crossing instances through Redis pub/sub adds about 0.2 ms at the median.

These are local numbers. In production, add your round trip to Render plus Render↔Neon
latency for each statement. Keep Render, Neon and Upstash in the same region (the blueprint
uses Frankfurt). The **latency badge** in the board header shows your own live numbers:
median and p95 of your recent changes, plus the network round trip. To benchmark a
deployment:

```bash
pnpm bench:latency --api https://<your-service>.onrender.com
# two instances behind one Redis:
pnpm bench:latency --api http://localhost:4000 --peer-api http://localhost:4001
```

(Each run signs up two `bench-…@bench.flowsync.local` accounts; the board is deleted
afterwards.)

## Local setup

### Option A: Docker (one command)

```bash
docker compose up --build
```

| Service  | URL                                                       |
| -------- | --------------------------------------------------------- |
| Web app  | http://localhost:8080                                     |
| API      | http://localhost:4000 (`/health`, `/health/ready`)        |
| Postgres | `localhost:5433`, user/password `postgres`, db `flowsync` |
| Redis    | `localhost:6380`                                          |

The API applies migrations and seeds the demo workspace on boot. Open the app in two
browsers (or a normal and a private window), click **Try the demo** in both, and drag a card.

### Option B: run the apps directly

Requirements: Node 22, pnpm 10 (`corepack enable`), Postgres 16 and Redis 7 (or
`docker compose up postgres redis`, and use ports 5433/6380 in `.env`).

```bash
pnpm install
cp .env.example .env          # adjust DATABASE_URL / REDIS_URL if needed
pnpm db:generate              # Prisma client
pnpm db:deploy                # apply migrations (or `pnpm db:migrate` while developing)
pnpm dev                      # API on :4000, web on :5173
```

`pnpm db:seed` re-creates the demo workspace on demand.

### Scripts

| Command                                     | What it does                                                      |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                                  | API (tsx watch) + web (Vite) in parallel                          |
| `pnpm build`                                | Build every package                                               |
| `pnpm lint` / `pnpm format:check`           | ESLint / Prettier                                                 |
| `pnpm typecheck`                            | Strict `tsc` across the monorepo                                  |
| `pnpm test`                                 | Unit + integration tests (needs Postgres; see below)              |
| `pnpm e2e`                                  | Playwright smoke test (starts the API and a production web build) |
| `pnpm bench:latency`                        | Latency benchmark (see above)                                     |
| `pnpm db:migrate` / `db:deploy` / `db:seed` | Prisma migrate dev / deploy, demo seed                            |

## Testing

| Suite                      | Where                                 | What it covers                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared unit tests (60)     | `packages/shared/test`                | Fractional keys (reference vectors, 2,000-insert randomised ordering check, key growth), `resolvePosition` conflict rules, schemas                                                                                                                                                                                                                             |
| API integration tests (39) | `apps/api/test`                       | Auth, authorisation (404 for non-members), workspaces/members/boards, task ordering incl. **12 concurrent drops into one gap**, stale anchors, idempotent creates, columns, Socket.io (presence, broadcasts, no echo, access checks, validation, chat, cursor batching, board deletion), demo seeding/reset/advisory lock, guest pruning, rate limiter, config |
| Redis adapter test         | `apps/api/test/redis-adapter.test.ts` | Two API instances sharing Redis: cluster-wide presence and cross-instance broadcasts. Runs when `TEST_REDIS_URL` is set (always in CI).                                                                                                                                                                                                                        |
| Web unit tests (14)        | `apps/web/src/sync`                   | Sync engine: optimistic apply, ack adoption, rollback, rebase over remote changes, stale events, tombstones, resync; latency stats                                                                                                                                                                                                                             |
| E2E smoke (Playwright)     | `apps/web/e2e`                        | Two guests on one board: presence, create, drag across columns, live sync to the other session, activity entry, chat, persistence after reload; 375 px layout check                                                                                                                                                                                            |

The API tests run against a real Postgres database named by `TEST_DATABASE_URL` (default
`postgresql://postgres:postgres@localhost:5432/flowsync_test`). The suite applies migrations
and truncates tables, so it refuses to run unless the database name contains `test`. The
e2e test uses `E2E_DATABASE_URL` (default `…/flowsync_e2e`).

CI (`.github/workflows/ci.yml`) runs install → Prisma generate → lint → format check →
typecheck → tests (with Postgres and Redis service containers) → Playwright → and, in a
second job, `docker compose build`.

## Deploy

The Netlify site and the `flowsync.temitopeagbola.com` domain already exist. The steps
below set up the API and its data stores and connect them.

### 1. Postgres on Neon (free)

1. Create a project at [neon.tech](https://neon.tech), region **AWS Europe Central 1
   (Frankfurt)** to sit next to the Render service.
2. In _Connection details_, copy two strings:
   - **Pooled** (host contains `-pooler`), the `DATABASE_URL`;
   - **Direct** (toggle pooling off), the `DIRECT_URL` (used only by migrations).
     Keep `?sslmode=require`.

### 2. Redis on Upstash (free)

1. Create a Redis database at [upstash.com](https://upstash.com), region **eu-central-1**.
2. Copy the TLS connection string, `rediss://default:<password>@<host>:6379`, as
   `REDIS_URL`.

### 3. API on Render (free web service)

1. Render dashboard → **New → Blueprint** → select this repository. Render reads
   `render.yaml` and creates the `flowsync-api` web service (free plan, Frankfurt).
2. When prompted, paste `DATABASE_URL`, `DIRECT_URL` and `REDIS_URL`. `JWT_SECRET` is
   generated, and `CORS_ORIGIN` is preset to `https://flowsync.temitopeagbola.com`.
3. Deploy. The build runs `pnpm install` + `tsup`; the start command applies pending Prisma
   migrations, then starts the server, which seeds the demo workspace. Check
   `https://<service>.onrender.com/health/ready` → `{"ok":true,"checks":{"db":"ok","redis":"ok"}}`.

Free instances sleep after ~15 minutes without traffic. The web app pings `/health` as soon
as it loads, so the server starts waking while the visitor reads the landing page. Each wake
also refreshes the demo workspace if it is older than `DEMO_RESET_HOURS`.

### 4. Frontend on Netlify (existing site)

1. Site configuration → Environment variables → add
   `VITE_API_URL = https://<service>.onrender.com`.
2. Merge to `main`. `netlify.toml` builds from the repository root (the pnpm workspace
   root, so the shared package resolves), runs `pnpm --filter @flowsync/web build`, and
   publishes `apps/web/dist` with an SPA fallback.
3. If the old Next.js plugin is still listed under Site configuration → Build & deploy →
   Plugins, remove it.

To allow Netlify deploy previews to call the API, add a wildcard origin to `CORS_ORIGIN`,
e.g. `https://flowsync.temitopeagbola.com,https://deploy-preview-*--<netlify-site>.netlify.app`.

## Environment variables

All variables are listed with comments in [`.env.example`](.env.example).

| Variable                              | Where            | Required      | Description                                                                                         |
| ------------------------------------- | ---------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | API              | yes           | Postgres connection (Neon: pooled string)                                                           |
| `DIRECT_URL`                          | API              | yes           | Direct Postgres connection for `prisma migrate` (locally the same as `DATABASE_URL`)                |
| `REDIS_URL`                           | API              | no            | Redis for the Socket.io adapter (Upstash: `rediss://…`). Unset = in-memory adapter, single instance |
| `JWT_SECRET`                          | API              | in production | 32+ character secret for signing tokens (`openssl rand -base64 48`)                                 |
| `CORS_ORIGIN`                         | API              | yes           | Comma-separated allowed origins; `*` wildcards allowed                                              |
| `PORT`                                | API              | no            | Default `4000` (Render sets it)                                                                     |
| `NODE_ENV`                            | API              | no            | `development` / `test` / `production`                                                               |
| `DEMO_ENABLED`                        | API              | no            | `true` enables "Try the demo" and the demo seed (default `true`)                                    |
| `DEMO_RESET_HOURS`                    | API              | no            | Re-seed the demo workspace on boot when older than this (default `6`, `0` = never)                  |
| `AUTH_RATE_LIMIT`                     | API              | no            | Sign-in/sign-up/demo requests per IP per 15 min (default `30`)                                      |
| `LOG_LEVEL`                           | API              | no            | pino level (default `info`)                                                                         |
| `VITE_API_URL`                        | Web (build time) | yes           | Public API URL, e.g. `https://flowsync-api.onrender.com`                                            |
| `TEST_DATABASE_URL`, `TEST_REDIS_URL` | tests            | no            | Integration test database / Redis                                                                   |
| `E2E_DATABASE_URL`, `E2E_REDIS_URL`   | e2e              | no            | Database / Redis for the Playwright run                                                             |

## Stack and substitutions

| Layer    | Choice                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query (REST data), Zustand (live board store), dnd-kit (drag-and-drop), lucide icons |
| Backend  | Node.js 22, Express 5, Socket.io 4 with `@socket.io/redis-adapter` + ioredis, zod, pino, helmet, express-rate-limit                             |
| Data     | PostgreSQL via Prisma 6 (Neon in production), Redis (Upstash in production)                                                                     |
| Tooling  | pnpm workspaces, TypeScript (strict, `noUncheckedIndexedAccess`), ESLint, Prettier, Vitest, Playwright, tsup, GitHub Actions, Docker            |

**Substitutions: none.** Everything in the requested stack is used as specified. Additions
(Express, zod, dnd-kit, Zustand, TanStack Query) are libraries on top of it, not
replacements. One version note: Prisma is pinned to the 6.x line, which has a mature
Neon/PgBouncer story and a stable `prisma-client-js` generator. Moving to Prisma 7's driver
adapters is a contained follow-up.

## Security notes and trade-offs

- **Tokens in `localStorage`, not cookies.** The SPA (Netlify) and API (Render) are on
  different sites, and browsers increasingly block third-party cookies. The trade-off is
  exposure to XSS; mitigations are React's escaping, no `dangerouslySetInnerHTML`, strict
  input validation and short-lived guest tokens (24 h; 7 days for accounts). Putting the
  API on a subdomain of the app domain would allow `SameSite` cookies.
- **Authorisation**: every REST route and socket event checks workspace membership, and
  every query is scoped to the board, so an id from another board is "not found". Non-members
  get **404** rather than 403, so ids can't be probed. Sockets may only mutate the one board
  they joined.
- **Validation**: zod on every REST body, query, param and socket payload; JSON body limit
  100 kB; socket frames capped at 64 kB.
- **Abuse limits**: per-IP limits on sign-in, sign-up and demo creation; per-socket token
  buckets for mutations (20/s), chat (1/s, burst 8) and typing events.
- **Demo isolation**: guests are workspace _members_ (they can't invite people or delete
  boards), the demo workspace is periodically re-seeded, and guests are deleted after 24 h.
- **Secrets**: none committed; production refuses to start without `JWT_SECRET`; the Render
  blueprint generates it.
- **Passwords**: bcrypt (cost 10), with a constant-time path for unknown emails so login
  timing doesn't reveal which accounts exist.

## Project structure

```text
apps/
  api/                 Express + Socket.io API
    prisma/            schema + migrations (COLLATE "C" positions)
    src/http/          Express app, routes
    src/realtime/      Socket.io server, handlers, presence, cursor batching, rate limits
    src/services/      domain logic: tasks, columns, boards, workspaces, activity, access checks
    src/demo/          demo seed, guest accounts, reset + pruning
    scripts/           latency benchmark
    test/              integration tests (Postgres, Redis)
  web/                 React SPA
    src/sync/          sync engine (pure), board store (sockets), latency window
    src/board/         Kanban/list views, dnd hook, cursors, chat, activity, task dialog
    src/pages/         landing, workspaces, workspace, board
    e2e/               Playwright smoke test
packages/
  shared/              zod schemas, DTOs, socket event types, fractional indexing, ordering
docs/PLAN.md           architecture plan and decisions
docker-compose.yml     whole stack locally
render.yaml            Render blueprint (API)
netlify.toml           Netlify build (web)
```

## Limitations and next steps

- **No member removal or roles beyond owner/member.** Removing a member would also need to
  evict their sockets from the board rooms (`socketsLeave`).
- **Text fields are last-writer-wins per field.** Two people typing in the same description
  at once keep the last save; a CRDT (e.g. Yjs) would merge keystrokes.
- **Key length is unbounded in theory.** Pathological insert patterns grow keys slowly; a
  background job could rebalance a column's keys with `generateNKeysBetween`.
- **Rate limits for REST auth are per instance** (in-memory store); a Redis store would
  share them across instances.
- **Connection state recovery**: after a reconnect the client resyncs from a snapshot. The
  Redis Streams adapter would allow replaying missed events instead.
