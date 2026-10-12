/**
 * FlowSync update-latency benchmark.
 *
 *   pnpm bench:latency [--api URL] [--peer-api URL] [--moves N] [--interval MS] [--json]
 *
 * Two fresh accounts share a new board. Client A moves one task back and
 * forth between two columns, one move at a time; client B just listens.
 * For every move we record:
 *
 *   ack      A emits `task:move` → A receives the acknowledgement. Covers
 *            validation, the column-locked Postgres transaction, the
 *            activity row and the network round trip: the time until an
 *            optimistic change is confirmed.
 *   fan-out  A emits → B receives the `task:upserted` broadcast. With
 *            --peer-api pointing at a second API instance, this crosses the
 *            Redis adapter.
 *   rtt      `sync:ping` round trip, the network-only baseline.
 *
 * Both clients live in this process, so all timestamps share one clock.
 * The benchmark workspace is deleted afterwards (the two accounts remain).
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import type {
  Ack,
  AuthResponse,
  BoardDTO,
  BoardSummaryDTO,
  ClientToServerEvents,
  ServerToClientEvents,
  TaskDTO,
  WorkspaceDTO,
} from '@flowsync/shared';
import { io, type Socket } from 'socket.io-client';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:4000' },
    'peer-api': { type: 'string' },
    moves: { type: 'string', default: '200' },
    warmup: { type: 'string', default: '20' },
    // Stay under the server's per-socket mutation rate limit (20/s).
    interval: { type: 'string', default: '60' },
    json: { type: 'boolean', default: false },
  },
});

const API = values.api.replace(/\/$/, '');
const PEER_API = (values['peer-api'] ?? API).replace(/\/$/, '');
const MOVES = Number(values.moves);
const WARMUP = Number(values.warmup);
const INTERVAL_MS = Number(values.interval);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function http<T>(
  base: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function signup(name: string): Promise<AuthResponse> {
  const email = `bench-${randomUUID().slice(0, 8)}@bench.flowsync.local`;
  return http<AuthResponse>(API, '/api/auth/signup', {
    method: 'POST',
    body: { name, email, password: randomUUID() },
  });
}

function connect(base: string, token: string): Promise<Client> {
  const socket: Client = io(base, { auth: { token }, transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function ack<T>(socket: Client, event: string, payload: unknown): Promise<T> {
  const emitter = socket.timeout(10_000) as unknown as {
    emitWithAck(event: string, payload: unknown): Promise<Ack<T>>;
  };
  const response = await emitter.emitWithAck(event, payload);
  if (!response.ok) throw new Error(`${event} failed: ${response.error.message}`);
  return response.data;
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
  const mean = sorted.reduce((sum, x) => sum + x, 0) / Math.max(sorted.length, 1);
  return {
    n: sorted.length,
    mean,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

async function main(): Promise<void> {
  const alice = await signup('Bench Alice');
  const bob = await signup('Bench Bob');
  const workspace = await http<WorkspaceDTO>(API, '/api/workspaces', {
    method: 'POST',
    token: alice.token,
    body: { name: `Latency bench ${new Date().toISOString()}` },
  });

  try {
    await http(API, `/api/workspaces/${workspace.id}/members`, {
      method: 'POST',
      token: alice.token,
      body: { email: bob.user.email },
    });
    const summary = await http<BoardSummaryDTO>(API, `/api/workspaces/${workspace.id}/boards`, {
      method: 'POST',
      token: alice.token,
      body: { name: 'Bench board' },
    });
    const board = await http<BoardDTO>(API, `/api/boards/${summary.id}`, { token: alice.token });
    const [left, right] = [board.columns[0]!.id, board.columns[2]!.id];

    const a = await connect(API, alice.token);
    const b = await connect(PEER_API, bob.token);
    await ack(a, 'board:join', { boardId: board.id });
    await ack(b, 'board:join', { boardId: board.id });

    const task = await ack<TaskDTO>(a, 'task:create', {
      boardId: board.id,
      mutationId: randomUUID(),
      task: { id: randomUUID(), columnId: left, title: 'Benchmark task' },
    });

    const rtt: number[] = [];
    for (let i = 0; i < 50; i++) {
      const sent = performance.now();
      await new Promise<void>((resolve) => a.emit('sync:ping', sent, () => resolve()));
      rtt.push(performance.now() - sent);
    }

    // Broadcast arrival times, keyed by mutation id, stamped on receipt.
    const received = new Map<string, number>();
    b.on('task:upserted', (event) => received.set(event.mutationId, performance.now()));

    const acks: number[] = [];
    const fanouts: number[] = [];
    let missing = 0;
    for (let i = 0; i < WARMUP + MOVES; i++) {
      const mutationId = randomUUID();
      const sent = performance.now();
      await ack(a, 'task:move', {
        boardId: board.id,
        mutationId,
        taskId: task.id,
        toColumnId: i % 2 === 0 ? right : left,
        afterId: null,
        beforeId: null,
      });
      const acked = performance.now();
      // Wait (briefly) for the broadcast to reach the peer.
      const deadline = acked + 2_000;
      while (!received.has(mutationId) && performance.now() < deadline) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      await sleep(Math.max(0, INTERVAL_MS - (performance.now() - sent)));
      if (i < WARMUP) continue;
      acks.push(acked - sent);
      const arrival = received.get(mutationId);
      if (arrival === undefined) missing++;
      else fanouts.push(arrival - sent);
    }

    a.close();
    b.close();

    const result = {
      api: API,
      peerApi: PEER_API,
      crossInstance: PEER_API !== API,
      moves: MOVES,
      missingBroadcasts: missing,
      rtt: stats(rtt),
      ack: stats(acks),
      fanout: stats(fanouts),
    };

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const row = (label: string, s: ReturnType<typeof stats>) =>
      `${label.padEnd(26)}${[s.p50, s.p95, s.p99, s.max, s.mean].map((x) => x.toFixed(1).padStart(8)).join('')}`;
    console.log(
      `\nFlowSync latency benchmark: ${MOVES} sequential moves, one per ${INTERVAL_MS} ms (+${WARMUP} warm-up)`,
    );
    console.log(`client A → ${API}`);
    console.log(
      `client B → ${PEER_API}${result.crossInstance ? '  (different instance: via Redis adapter)' : ''}\n`,
    );
    console.log(
      `${'ms'.padEnd(26)}${['p50', 'p95', 'p99', 'max', 'mean'].map((h) => h.padStart(8)).join('')}`,
    );
    console.log(row('network round trip', result.rtt));
    console.log(row('move acked (A)', result.ack));
    console.log(row('move broadcast (A → B)', result.fanout));
    if (missing > 0) console.log(`\n${missing} broadcasts did not arrive within 2s`);
  } finally {
    await http(API, `/api/workspaces/${workspace.id}`, {
      method: 'DELETE',
      token: alice.token,
    }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
