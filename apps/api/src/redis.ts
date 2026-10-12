import { Redis } from 'ioredis';
import type { Logger } from './logger.js';

/**
 * Publisher + subscriber connections for the Socket.io Redis adapter.
 * Upstash URLs use `rediss://` (TLS), which ioredis handles from the scheme.
 */
export function connectRedis(url: string, logger: Logger): { pub: Redis; sub: Redis } {
  const pub = new Redis(url, { maxRetriesPerRequest: 3 });
  const sub = pub.duplicate();
  for (const [name, client] of [
    ['pub', pub],
    ['sub', sub],
  ] as const) {
    client.on('error', (err) => logger.error({ err }, `redis ${name} error`));
  }
  return { pub, sub };
}
