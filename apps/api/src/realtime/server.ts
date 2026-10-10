import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { authenticate } from '../auth/middleware.js';
import { originMatcher, type Config } from '../config.js';
import type { Db } from '../db.js';
import type { RealtimeHooks } from '../http/context.js';
import type { Logger } from '../logger.js';
import { CursorHub } from './cursors.js';
import { registerHandlers } from './handlers.js';
import { boardRoom, type IO } from './types.js';

export interface RealtimeDeps {
  prisma: Db;
  config: Config;
  logger: Logger;
  redis?: { pub: Redis; sub: Redis };
}

export interface Realtime extends RealtimeHooks {
  io: IO;
  close(): Promise<void>;
}

export function createRealtime(httpServer: HttpServer, deps: RealtimeDeps): Realtime {
  const { prisma, config, logger } = deps;
  const allowOrigin = originMatcher(config.corsOrigins);

  const io: IO = new Server(httpServer, {
    cors: { origin: (origin, callback) => callback(null, allowOrigin(origin)) },
    // Board payloads are small; cap frames so one client cannot send huge ones.
    maxHttpBufferSize: 64 * 1024,
  });

  if (deps.redis) {
    // Every broadcast is published to Redis and re-emitted by every API
    // instance to its own sockets in that room.
    io.adapter(createAdapter(deps.redis.pub, deps.redis.sub, { requestsTimeout: 3_000 }));
    logger.info('socket.io using the Redis adapter');
  } else {
    logger.warn('REDIS_URL not set: socket.io using the in-memory adapter (single instance only)');
  }

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const user = await authenticate(
      prisma,
      config.jwtSecret,
      typeof token === 'string' ? token : undefined,
    ).catch(() => null);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.user = { id: user.id, name: user.name, avatarColor: user.avatarColor };
    next();
  });

  const cursors = new CursorHub(io);
  io.on('connection', (socket) => registerHandlers(socket, { io, prisma, logger, cursors }));

  return {
    io,
    boardDeleted(boardId) {
      io.to(boardRoom(boardId)).emit('board:deleted', { boardId });
      io.in(boardRoom(boardId)).socketsLeave(boardRoom(boardId));
    },
    async close() {
      cursors.stop();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    },
  };
}
