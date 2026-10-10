import type { AuthResponse, UserDTO, WorkspaceDTO } from '@flowsync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, resetDatabase, signupUser, startServer, type TestServer } from './helpers.js';

let t: TestServer;

beforeAll(async () => {
  t = await startServer();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.prisma));

describe('auth', () => {
  it('signs up, logs in and returns the current user', async () => {
    const signup = await api<AuthResponse>(t.url, '/api/auth/signup', {
      method: 'POST',
      body: { name: 'Ada Lovelace', email: 'ADA@example.org', password: 'analytical' },
    });
    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.org',
      isGuest: false,
    });
    expect(signup.body).not.toHaveProperty('user.passwordHash');

    const login = await api<AuthResponse>(t.url, '/api/auth/login', {
      method: 'POST',
      body: { email: 'ada@example.org', password: 'analytical' },
    });
    expect(login.status).toBe(200);

    const me = await api<{ user: UserDTO }>(t.url, '/api/auth/me', { token: login.body.token });
    expect(me.body.user.id).toBe(signup.body.user.id);
  });

  it('rejects duplicate emails, bad passwords and invalid input', async () => {
    await signupUser(t.url, 'Grace');
    const body = { name: 'Grace', email: 'grace@example.org', password: 'compilers' };
    expect((await api(t.url, '/api/auth/signup', { method: 'POST', body })).status).toBe(201);
    const duplicate = await api<{ error: { code: string } }>(t.url, '/api/auth/signup', {
      method: 'POST',
      body,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const wrong = await api(t.url, '/api/auth/login', {
      method: 'POST',
      body: { email: 'grace@example.org', password: 'nope-nope' },
    });
    expect(wrong.status).toBe(401);
    const unknown = await api(t.url, '/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.org', password: 'whatever1' },
    });
    expect(unknown.status).toBe(401);

    const invalid = await api<{ error: { code: string; fields: Record<string, string> } }>(
      t.url,
      '/api/auth/signup',
      { method: 'POST', body: { name: '', email: 'not-an-email', password: '123' } },
    );
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('requires a valid token on protected routes', async () => {
    expect((await api(t.url, '/api/workspaces')).status).toBe(401);
    expect((await api(t.url, '/api/workspaces', { token: 'garbage' })).status).toBe(401);
  });

  it('rejects tokens of deleted users', async () => {
    const { token, user } = await signupUser(t.url, 'Temp');
    await t.prisma.user.delete({ where: { id: user.id } });
    expect((await api(t.url, '/api/auth/me', { token })).status).toBe(401);
  });

  it('"Try the demo" creates a guest who can see the seeded demo workspace', async () => {
    const res = await api<AuthResponse>(t.url, '/api/auth/demo', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.body.user.isGuest).toBe(true);
    expect(res.body.user.name).toMatch(/^\w+ \w+$/);

    const workspaces = await api<WorkspaceDTO[]>(t.url, '/api/workspaces', {
      token: res.body.token,
    });
    expect(workspaces.body).toHaveLength(1);
    expect(workspaces.body[0]).toMatchObject({ isDemo: true, role: 'MEMBER', boardCount: 2 });

    // A second guest joins the same workspace, as a different person.
    const second = await api<AuthResponse>(t.url, '/api/auth/demo', { method: 'POST' });
    expect(second.body.user.id).not.toBe(res.body.user.id);
    const theirs = await api<WorkspaceDTO[]>(t.url, '/api/workspaces', {
      token: second.body.token,
    });
    expect(theirs.body[0]?.id).toBe(workspaces.body[0]?.id);
  });

  it('serves a JSON 404 for unknown routes and a malformed body', async () => {
    expect((await api(t.url, '/api/nope')).status).toBe(404);
    const res = await fetch(`${t.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":',
    });
    expect(res.status).toBe(400);
  });
});
