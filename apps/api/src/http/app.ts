import { Prisma } from '@prisma/client';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { requireAuth } from '../auth/middleware.js';
import { originMatcher } from '../config.js';
import { AppError } from '../errors.js';
import type { AppContext } from './context.js';
import { authRouter } from './routes/auth.js';
import { boardsRouter } from './routes/boards.js';
import { workspacesRouter } from './routes/workspaces.js';

export function createApp(ctx: AppContext): Express {
  const { prisma, config, logger } = ctx;
  const app = express();
  const allowOrigin = originMatcher(config.corsOrigins);

  // Render / Docker put us behind one proxy hop; needed for per-IP rate limits.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => callback(null, allowOrigin(origin)),
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );

  // Liveness: cheap, no dependencies. The SPA hits it on load to wake a sleeping instance.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.get('/health/ready', async (_req, res) => {
    const checks: Record<string, 'ok' | 'error' | 'disabled'> = { db: 'ok', redis: 'disabled' };
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.db = 'error';
    }
    if (ctx.pingRedis) {
      checks.redis = await ctx
        .pingRedis()
        .then(() => 'ok' as const)
        .catch(() => 'error' as const);
    }
    const ok = !Object.values(checks).includes('error');
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  app.use('/api/auth', authRouter(ctx));
  const auth = requireAuth(prisma, config.jwtSecret);
  app.use('/api/workspaces', auth, workspacesRouter(ctx));
  app.use('/api/boards', auth, boardsRouter(ctx));

  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Route not found')));

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, fields: error.fields },
      });
      return;
    }
    // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = error instanceof SyntaxError ? 'Malformed JSON body' : 'Invalid request';
      res.status(status).json({ error: { code: 'VALIDATION', message } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    req.log.error({ err: error }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
  app.use(errorHandler);

  return app;
}
