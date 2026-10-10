# FlowSync — build plan

The repo started as a 10-file Next.js landing-page stub (`frontend/app/page.tsx`, generic README,
`netlify.toml` pointing at `.next`). It was removed and replaced with the MVP described below.

## Goal

A small but real collaborative Kanban: several people edit the same board and see each other's
cursors, presence, chat and changes live. Every change is persisted in Postgres. The UI updates
optimistically, and the server's answer is always the final word.

## Architecture

```
apps/web         React 19 + Vite + Tailwind v4 SPA       → Netlify (existing site)
apps/api         Node 22 + Express 5 + Socket.io 4       → Render free web service
                 Prisma 6 → PostgreSQL                    → Neon
                 @socket.io/redis-adapter → Redis         → Upstash
packages/shared  zod schemas, DTO + socket event types, fractional indexing, ordering rules
```

- **REST** for auth, workspaces, boards, initial board snapshot, chat history and activity pages.
- **Socket.io** for board-scoped real-time traffic: task/column mutations (with acks), chat,
  presence, cursors. Each mutation is validated with zod, checked against board membership, run
  in a Postgres transaction that also writes the activity row, then acked to the sender and
  broadcast to the board room.
- **Redis adapter** fans out broadcasts across API instances (and powers cluster-wide presence
  via `fetchSockets`). Without `REDIS_URL` the in-memory adapter is used (single instance).

## Key decisions

| Concern             | Decision                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordering            | Fractional index keys (base-62 strings). One row write per move, no sibling reindexing.                                                                                                                                                                         |
| Ordering conflicts  | Clients send _intent_ (`afterTaskId` / `beforeTaskId`), not a raw key. The server locks the target column row (`SELECT … FOR UPDATE`), re-reads siblings, re-derives the key from the anchors that still exist. `UNIQUE(columnId, position)` is the safety net. |
| Collation           | `position` columns use `COLLATE "C"` so Postgres orders keys byte-wise, the same way JS compares them.                                                                                                                                                          |
| Optimistic UI       | Client store = confirmed server state + queue of pending mutations; the view is the pending queue replayed on top of server state. Ack replaces state with the canonical row; rejection just drops the pending entry (automatic rollback).                      |
| Out-of-order events | Every task carries a `version`; stale broadcasts are ignored; deleted ids are tombstoned.                                                                                                                                                                       |
| Auth                | Email + password (bcrypt) → JWT bearer token. Not cookies: the SPA (Netlify) and API (Render) are on different sites, and third-party cookies get blocked.                                                                                                      |
| Demo                | "Try the demo" creates a guest account (random friendly name) that joins a seeded demo workspace, so two tabs look like two people. The demo workspace is re-seeded on boot when older than `DEMO_RESET_HOURS`. Guests expire after 24h.                        |
| Cursors             | Client throttles to ~20 Hz; the server coalesces all cursor moves in a board into one volatile broadcast per 50 ms tick. This keeps the number of Redis PUBLISH commands low enough for the Upstash free tier.                                                  |
| Cold starts         | The SPA pings `/health` on load, flags any request slower than 2s, and shows a "Waking the server…" banner. Idempotent requests are retried on 502/503/504 and network errors.                                                                                  |

## Milestones (each a small commit)

1. Monorepo scaffold (pnpm workspaces, strict TS, ESLint, Prettier).
2. `packages/shared`: fractional indexing + ordering rules + schemas, with unit tests.
3. API: Prisma schema + migration, auth, workspaces/boards REST, tests.
4. API: Socket.io realtime (mutations, presence, cursors, chat, activity), Redis adapter, tests.
5. API: demo seed + guest login + cleanup.
6. Web: auth + demo login, workspaces/boards, waking-server UX, dark mode.
7. Web: sync engine (optimistic + reconciliation) with unit tests.
8. Web: Kanban + list views with drag-and-drop, cursors, presence, chat, activity.
9. Infra: Dockerfiles, docker-compose, render.yaml, netlify.toml, GitHub Actions CI.
10. Playwright smoke test, latency benchmark, README.
