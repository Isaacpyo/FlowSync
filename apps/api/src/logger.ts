import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export function createLogger(config: Pick<Config, 'env' | 'logLevel'>): Logger {
  const pretty = config.env === 'development';
  return pino({
    level: config.env === 'test' ? 'silent' : config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(pretty
      ? {
          transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
        }
      : {}),
  });
}

export type { Logger };
