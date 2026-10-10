import type {
  AuthResponse,
  BoardDTO,
  BoardSummaryDTO,
  JoinResult,
  WorkspaceDTO,
} from '@flowsync/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_REDIS_URL } from './env.js';
import {
  api,
  connect,
  expectOk,
  nextEvent,
  request,
  resetDatabase,
  signupUser,
  startServer,
  uuid,
  type TestServer,
} from './helpers.js';

/**
 * Two API instances sharing one Redis: a client on instance A must see
 * events and presence from a client on instance B. This is what lets the
 * API scale past one process.
 */
describe.runIf(TEST_REDIS_URL)('Socket.io Redis adapter (two instances)', () => {
  let a: TestServer;
  let b: TestServer;
  let alice: AuthResponse;
  let bob: AuthResponse;
  let board: BoardDTO;

  beforeAll(async () => {
    a = await startServer({ REDIS_URL: TEST_REDIS_URL! });
    b = await startServer({ REDIS_URL: TEST_REDIS_URL! });
    await resetDatabase(a.prisma);
    alice = await signupUser(a.url, 'Alice');
    bob = await signupUser(b.url, 'Bob');
    const ws = await api<WorkspaceDTO>(a.url, '/api/workspaces', {
      method: 'POST',
      token: alice.token,
      body: { name: 'Cluster' },
    });
    await api(a.url, `/api/workspaces/${ws.body.id}/members`, {
      method: 'POST',
      token: alice.token,
      body: { email: bob.user.email },
    });
    const created = await api<BoardSummaryDTO>(a.url, `/api/workspaces/${ws.body.id}/boards`, {
      method: 'POST',
      token: alice.token,
      body: { name: 'Shared' },
    });
    board = (await api<BoardDTO>(a.url, `/api/boards/${created.body.id}`, { token: alice.token }))
      .body;
  });

  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it('fans out mutations and presence across instances', async () => {
    const onA = await connect(a.url, alice.token);
    const onB = await connect(b.url, bob.token);
    try {
      expectOk(await request(onA, 'board:join', { boardId: board.id }));
      const joined = expectOk(await request<JoinResult>(onB, 'board:join', { boardId: board.id }));
      // fetchSockets() asked both instances.
      expect(joined.presence.map((p) => p.name)).toEqual(['Alice', 'Bob']);

      const seenOnB = nextEvent(onB, 'task:upserted');
      const taskId = uuid();
      expectOk(
        await request(onA, 'task:create', {
          boardId: board.id,
          mutationId: uuid(),
          task: { id: taskId, columnId: board.columns[0]!.id, title: 'Across the wire' },
        }),
      );
      expect((await seenOnB).task.id).toBe(taskId);
    } finally {
      onA.close();
      onB.close();
    }
  });
});
