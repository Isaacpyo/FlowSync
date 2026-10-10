import { z } from 'zod';

const DEV_JWT_SECRET = 'flowsync-dev-secret-change-me-0123456789abcdef';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DEMO_ENABLED: z.stringbool().default(true),
  DEMO_RESET_HOURS: z.coerce.number().min(0).default(6),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string | undefined;
  jwtSecret: string;
  corsOrigins: string[];
  demo: { enabled: boolean; resetHours: number };
  authRateLimit: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` in an env file means "unset", not "empty string".
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${details}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && !e.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
    demo: { enabled: e.DEMO_ENABLED, resetHours: e.DEMO_RESET_HOURS },
    authRateLimit: e.AUTH_RATE_LIMIT,
    logLevel: e.LOG_LEVEL,
  };
}

/**
 * Build an origin check from a list that may contain `*` wildcards, e.g.
 * `https://deploy-preview-*--flowsync.netlify.app` for Netlify previews.
 */
export function originMatcher(origins: string[]): (origin: string | undefined) => boolean {
  const patterns = origins.map((origin) => {
    if (origin === '*') return /^.*$/;
    const escaped = origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
  });
  return (origin) => origin === undefined || patterns.some((pattern) => pattern.test(origin));
}
