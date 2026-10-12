import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '../logger.js';

/** What the realtime layer exposes to REST handlers. */
export interface RealtimeHooks {
  boardDeleted(boardId: string): void;
}

export interface AppContext {
  prisma: Db;
  config: Config;
  logger: Logger;
  realtime: RealtimeHooks;
  /** Readiness probe for Redis; undefined when running without Redis. */
  pingRedis?: () => Promise<unknown>;
}
