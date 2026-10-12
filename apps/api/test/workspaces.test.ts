import type {
  ActivityDTO,
  BoardDTO,
  BoardSummaryDTO,
  MemberDTO,
  Page,
  WorkspaceDetailDTO,
  WorkspaceDTO,
} from '@flowsync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, resetDatabase, signupUser, startServer, type TestServer } from './helpers.js';

let t: TestServer;

beforeAll(async () => {
  t = await startServer();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.prisma));

async function workspaceWithBoard(token: string) {
  const ws = await api<WorkspaceDTO>(t.url, '/api/workspaces', {
    method: 'POST',
    token,
    body: { name: 'Studio' },
  });
  const board = await api<BoardSummaryDTO>(t.url, `/api/workspaces/${ws.body.id}/boards`, {
    method: 'POST',
    token,
    body: { name: 'Launch', description: 'Ship it' },
  });
  return { workspace: ws.body, board: board.body };
}

describe('workspaces and boards', () => {
  it('creates a workspace and a board with default columns', async () => {
    const owner = await signupUser(t.url, 'Owner');
    const { workspace, board } = await workspaceWithBoard(owner.token);
    expect(workspace).toMatchObject({
      name: 'Studio',
      role: 'OWNER',
      memberCount: 1,
      boardCount: 0,
    });

    const snapshot = await api<BoardDTO>(t.url, `/api/boards/${board.id}`, { token: owner.token });
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.columns.map((c) => c.name)).toEqual(['To do', 'In progress', 'Done']);
    expect(snapshot.body.tasks).toEqual([]);
    expect(snapshot.body.workspaceName).toBe('Studio');

    const activity = await api<Page<ActivityDTO>>(t.url, `/api/boards/${board.id}/activity`, {
      token: owner.token,
    });
    expect(activity.body.items.map((a) => a.type)).toEqual(['board.created']);

    const list = await api<WorkspaceDTO[]>(t.url, '/api/workspaces', { token: owner.token });
    expect(list.body).toEqual([expect.objectContaining({ id: workspace.id, boardCount: 1 })]);
  });

  it('hides other workspaces and boards from non-members (404, not 403)', async () => {
    const owner = await signupUser(t.url, 'Owner');
    const stranger = await signupUser(t.url, 'Stranger');
    const { workspace, board } = await workspaceWithBoard(owner.token);

    expect(
      (await api(t.url, `/api/workspaces/${workspace.id}`, { token: stranger.token })).status,
    ).toBe(404);
    expect((await api(t.url, `/api/boards/${board.id}`, { token: stranger.token })).status).toBe(
      404,
    );
    expect(
      (await api(t.url, `/api/boards/${board.id}/messages`, { token: stranger.token })).status,
    ).toBe(404);
    expect(
      (
        await api(t.url, `/api/workspaces/${workspace.id}/boards`, {
          method: 'POST',
          token: stranger.token,
          body: { name: 'Sneaky' },
        })
      ).status,
    ).toBe(404);
  });

  it('lets the owner invite members by email; members cannot invite or delete', async () => {
    const owner = await signupUser(t.url, 'Owner');
    const mate = await signupUser(t.url, 'Mate');
    const other = await signupUser(t.url, 'Other');
    const { workspace, board } = await workspaceWithBoard(owner.token);

    const invite = await api<MemberDTO>(t.url, `/api/workspaces/${workspace.id}/members`, {
      method: 'POST',
      token: owner.token,
      body: { email: mate.user.email.toUpperCase() },
    });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({ id: mate.user.id, role: 'MEMBER' });

    const again = await api(t.url, `/api/workspaces/${workspace.id}/members`, {
      method: 'POST',
      token: owner.token,
      body: { email: mate.user.email },
    });
    expect(again.status).toBe(409);

    const unknown = await api(t.url, `/api/workspaces/${workspace.id}/members`, {
      method: 'POST',
      token: owner.token,
      body: { email: 'ghost@example.org' },
    });
    expect(unknown.status).toBe(404);

    const byMember = await api(t.url, `/api/workspaces/${workspace.id}/members`, {
      method: 'POST',
      token: mate.token,
      body: { email: other.user.email },
    });
    expect(byMember.status).toBe(403);

    const detail = await api<WorkspaceDetailDTO>(t.url, `/api/workspaces/${workspace.id}`, {
      token: mate.token,
    });
    expect(detail.body.members.map((m) => m.name)).toEqual(['Owner', 'Mate']);
    expect(detail.body.boards).toHaveLength(1);

    expect(
      (await api(t.url, `/api/boards/${board.id}`, { method: 'DELETE', token: mate.token })).status,
    ).toBe(403);
    expect(
      (await api(t.url, `/api/boards/${board.id}`, { method: 'DELETE', token: owner.token }))
        .status,
    ).toBe(204);
    expect((await api(t.url, `/api/boards/${board.id}`, { token: owner.token })).status).toBe(404);
  });

  it('validates ids and bodies', async () => {
    const owner = await signupUser(t.url, 'Owner');
    expect((await api(t.url, '/api/boards/not-a-uuid', { token: owner.token })).status).toBe(400);
    expect(
      (
        await api(t.url, '/api/workspaces', {
          method: 'POST',
          token: owner.token,
          body: { name: '   ' },
        })
      ).status,
    ).toBe(400);
  });
});
