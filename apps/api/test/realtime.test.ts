import type {
  AuthResponse,
  BoardDTO,
  BoardSummaryDTO,
  JoinResult,
  MessageDTO,
  Page,
  TaskDTO,
  WorkspaceDTO,
} from '@flowsync/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  type Client,
  type TestServer,
} from './helpers.js';

let t: TestServer;
let alice: AuthResponse;
let bob: AuthResponse;
let board: BoardDTO;
const sockets: Client[] = [];

async function client(auth: AuthResponse): Promise<Client> {
  const socket = await connect(t.url, auth.token);
  sockets.push(socket);
  return socket;
}

beforeAll(async () => {
  t = await startServer();
});
afterAll(() => t.close());

beforeEach(async () => {
  await resetDatabase(t.prisma);
  alice = await signupUser(t.url, 'Alice');
  bob = await signupUser(t.url, 'Bob');
  const ws = await api<WorkspaceDTO>(t.url, '/api/workspaces', {
    method: 'POST',
    token: alice.token,
    body: { name: 'Team' },
  });
  await api(t.url, `/api/workspaces/${ws.body.id}/members`, {
    method: 'POST',
    token: alice.token,
    body: { email: bob.user.email },
  });
  const created = await api<BoardSummaryDTO>(t.url, `/api/workspaces/${ws.body.id}/boards`, {
    method: 'POST',
    token: alice.token,
    body: { name: 'Realtime' },
  });
  board = (await api<BoardDTO>(t.url, `/api/boards/${created.body.id}`, { token: alice.token }))
    .body;
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

function newTask(columnId: string, title = 'Live task') {
  return {
    boardId: board.id,
    mutationId: uuid(),
    task: { id: uuid(), columnId, title },
  };
}

describe('realtime board', () => {
  it('rejects connections without a valid token', async () => {
    await expect(connect(t.url, 'nope')).rejects.toThrow('UNAUTHORIZED');
  });

  it('shares presence and broadcasts mutations to the other members', async () => {
    const a = await client(alice);
    const b = await client(bob);

    const joinedA = expectOk(await request<JoinResult>(a, 'board:join', { boardId: board.id }));
    expect(joinedA.presence.map((p) => p.name)).toEqual(['Alice']);

    const presenceSeenByA = nextEvent(a, 'presence:update', (p) => p.users.length === 2);
    const joinedB = expectOk(await request<JoinResult>(b, 'board:join', { boardId: board.id }));
    expect(joinedB.presence.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    await presenceSeenByA;

    // Alice creates a task: she gets the canonical row in her ack, Bob gets a broadcast.
    const input = newTask(board.columns[0]!.id);
    const upserted = nextEvent(b, 'task:upserted');
    const activity = nextEvent(b, 'activity:new');
    const task = expectOk(await request<TaskDTO>(a, 'task:create', input));
    expect(task).toMatchObject({ id: input.task.id, title: 'Live task', version: 1 });
    const event = await upserted;
    expect(event).toMatchObject({ mutationId: input.mutationId, actorId: alice.user.id });
    expect(event.task.id).toBe(task.id);
    expect((await activity).activity.type).toBe('task.created');

    // Bob moves it; Alice sees the new column and a bumped version.
    const moved = nextEvent(a, 'task:upserted', (e) => e.task.columnId === board.columns[2]!.id);
    expectOk(
      await request(b, 'task:move', {
        boardId: board.id,
        mutationId: uuid(),
        taskId: task.id,
        toColumnId: board.columns[2]!.id,
        afterId: null,
        beforeId: null,
      }),
    );
    expect((await moved).task.version).toBe(2);

    // Bob leaving updates Alice's presence.
    const left = nextEvent(a, 'presence:update', (p) => p.users.length === 1);
    b.close();
    expect((await left).users.map((u) => u.name)).toEqual(['Alice']);
  });

  it('does not echo a mutation back to the socket that made it', async () => {
    const a = await client(alice);
    expectOk(await request(a, 'board:join', { boardId: board.id }));
    let echoed = false;
    a.on('task:upserted', () => {
      echoed = true;
    });
    expectOk(await request(a, 'task:create', newTask(board.columns[0]!.id)));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(echoed).toBe(false);
  });

  it('enforces access, joins and validation on every event', async () => {
    const stranger = await signupUser(t.url, 'Mallory');
    const m = await client(stranger);
    const denied = await request(m, 'board:join', { boardId: board.id });
    expect(denied).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Board not found' } });

    // Not joined yet → forbidden, even for a member.
    const a = await client(alice);
    const notJoined = await request(a, 'task:create', newTask(board.columns[0]!.id));
    expect(notJoined.ok === false && notJoined.error.code).toBe('FORBIDDEN');

    expectOk(await request(a, 'board:join', { boardId: board.id }));
    const invalid = await request(a, 'task:create', {
      boardId: board.id,
      mutationId: 'x',
      task: { title: '' },
    });
    expect(invalid.ok === false && invalid.error.code).toBe('VALIDATION');

    // A column id from another board is not found, not silently accepted.
    const missing = await request(a, 'task:create', newTask(uuid()));
    expect(missing.ok === false && missing.error.code).toBe('NOT_FOUND');
  });

  it('delivers chat messages live and persists them', async () => {
    const a = await client(alice);
    const b = await client(bob);
    expectOk(await request(a, 'board:join', { boardId: board.id }));
    expectOk(await request(b, 'board:join', { boardId: board.id }));

    const typing = nextEvent(b, 'chat:typing');
    a.emit('chat:typing', { boardId: board.id, typing: true });
    expect(await typing).toMatchObject({ name: 'Alice', typing: true });

    const received = nextEvent(b, 'chat:message');
    const sent = expectOk(
      await request<MessageDTO>(a, 'chat:send', {
        boardId: board.id,
        clientId: 'c1',
        body: '  Hello team  ',
      }),
    );
    expect(sent).toMatchObject({ body: 'Hello team', clientId: 'c1', author: { name: 'Alice' } });
    expect((await received).message.id).toBe(sent.id);

    const history = await api<Page<MessageDTO>>(t.url, `/api/boards/${board.id}/messages`, {
      token: bob.token,
    });
    expect(history.body.items.map((m) => m.body)).toEqual(['Hello team']);
  });

  it('batches cursor moves and announces when a cursor leaves', async () => {
    const a = await client(alice);
    const b = await client(bob);
    expectOk(await request(a, 'board:join', { boardId: board.id }));
    expectOk(await request(b, 'board:join', { boardId: board.id }));

    const batch = nextEvent(b, 'cursor:batch', (e) => e.cursors.some((c) => c.socketId === a.id));
    for (let x = 0; x < 10; x++)
      a.emit('cursor:move', { boardId: board.id, x, y: 5, view: 'kanban' });
    const { cursors } = await batch;
    // Ten moves inside one tick collapse into the latest position.
    expect(cursors.filter((c) => c.socketId === a.id)).toEqual([
      expect.objectContaining({ x: 9, y: 5, name: 'Alice', userId: alice.user.id }),
    ]);

    const left = nextEvent(b, 'cursor:left', (e) => e.socketId === a.id);
    a.emit('cursor:leave', { boardId: board.id });
    await left;
  });

  it('tells connected clients when their board is deleted', async () => {
    const b = await client(bob);
    expectOk(await request(b, 'board:join', { boardId: board.id }));
    const deleted = nextEvent(b, 'board:deleted');
    await api(t.url, `/api/boards/${board.id}`, { method: 'DELETE', token: alice.token });
    expect((await deleted).boardId).toBe(board.id);
  });

  it('answers latency probes', async () => {
    const a = await client(alice);
    const echoed = await (
      a.timeout(2_000) as unknown as {
        emitWithAck(event: 'sync:ping', sentAt: number): Promise<number>;
      }
    ).emitWithAck('sync:ping', 1234);
    expect(echoed).toBe(1234);
  });
});
