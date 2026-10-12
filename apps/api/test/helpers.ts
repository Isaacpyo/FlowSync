import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type {
  Ack,
  AuthResponse,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@flowsync/shared';
import { io, type Socket } from 'socket.io-client';
import { loadConfig, type Config } from '../src/config.js';
import { createPrisma, type Db } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { createFlowSyncServer, type FlowSyncServer } from '../src/server.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './env.js';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    AUTH_RATE_LIMIT: '10000',
    DEMO_RESET_HOURS: '0',
    ...env,
  });
}

export async function resetDatabase(prisma: Db): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Activity", "Message", "Task", "Column", "Board", "Membership", "Workspace", "User" CASCADE',
  );
}

export interface TestServer {
  url: string;
  prisma: Db;
  config: Config;
  server: FlowSyncServer;
  close(): Promise<void>;
}

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const config = testConfig(env);
  const prisma = createPrisma(config.databaseUrl);
  const server = createFlowSyncServer({ config, prisma, logger: createLogger(config) });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    prisma,
    config,
    server,
    async close() {
      await server.close();
      await prisma.$disconnect();
    },
  };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** Minimal JSON client for the REST API. */
export async function api<T = unknown>(
  url: string,
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export async function signupUser(url: string, name = 'Test User'): Promise<AuthResponse> {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${randomUUID().slice(0, 8)}@test.dev`;
  const res = await api<AuthResponse>(url, '/api/auth/signup', {
    method: 'POST',
    body: { name, email, password: 'password123' },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function connect(url: string, token: string): Promise<Client> {
  const socket: Client = io(url, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

type EventArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

/** Resolve with the next `event` payload that matches `predicate`. */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: Client,
  event: E,
  predicate: (payload: EventArgs<E>) => boolean = () => true,
  timeoutMs = 3_000,
): Promise<EventArgs<E>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener as never);
      reject(new Error(`timed out waiting for ${String(event)}`));
    }, timeoutMs);
    const listener = (payload: EventArgs<E>) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener as never);
      resolve(payload);
    };
    socket.on(event, listener as never);
  });
}

/** Emit a request event and wait for its acknowledgement. */
export async function request<T>(socket: Client, event: string, payload: unknown): Promise<Ack<T>> {
  const emitter = socket.timeout(5_000) as unknown as {
    emitWithAck(event: string, payload: unknown): Promise<Ack<T>>;
  };
  return emitter.emitWithAck(event, payload);
}

export function expectOk<T>(ack: Ack<T>): T {
  if (!ack.ok) throw new Error(`expected ok ack, got ${ack.error.code}: ${ack.error.message}`);
  return ack.data;
}

export const uuid = () => randomUUID();
