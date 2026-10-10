import { createServer, type Server as HttpServer } from 'node:http';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { createApp } from './http/app.js';
import type { Logger } from './logger.js';
import { createRealtime, type Realtime } from './realtime/server.js';
import type { IO } from './realtime/types.js';
import { connectRedis } from './redis.js';

export interface FlowSyncServer {
  httpServer: HttpServer;
  io: IO;
  close(): Promise<void>;
}

/** Wire Express, Socket.io and (optionally) Redis around one HTTP server. */
export function createFlowSyncServer(deps: {
  config: Config;
  prisma: Db;
  logger: Logger;
}): FlowSyncServer {
  const { config, prisma, logger } = deps;
  const redis = config.redisUrl ? connectRedis(config.redisUrl, logger) : undefined;

  // REST handlers need to notify sockets (e.g. board deleted); the realtime
  // layer needs the HTTP server. Break the cycle with a late-bound hook.
  const late: { realtime?: Realtime } = {};
  const app = createApp({
    prisma,
    config,
    logger,
    realtime: { boardDeleted: (boardId) => late.realtime?.boardDeleted(boardId) },
    ...(redis ? { pingRedis: () => redis.pub.ping() } : {}),
  });
  const httpServer = createServer(app);
  const realtime = createRealtime(httpServer, {
    prisma,
    config,
    logger,
    ...(redis ? { redis } : {}),
  });
  late.realtime = realtime;

  return {
    httpServer,
    io: realtime.io,
    async close() {
      await realtime.close();
      if (redis) await Promise.allSettled([redis.pub.quit(), redis.sub.quit()]);
    },
  };
}
