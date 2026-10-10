import { loginSchema, signupSchema } from '@flowsync/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { currentUser, requireAuth } from '../../auth/middleware.js';
import { AppError } from '../../errors.js';
import { createGuest } from '../../demo/demo.js';
import { toUserDTO } from '../../services/mappers.js';
import { login, signup } from '../../services/users.js';
import { parse } from '../../validate.js';
import type { AppContext } from '../context.js';

function limiter(limit: number, windowMinutes: number) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMITED', 'Too many attempts, try again later')),
  });
}

export function authRouter({ prisma, config }: AppContext): Router {
  const router = Router();
  const credentialsLimiter = limiter(config.authRateLimit, 15);
  const demoLimiter = limiter(config.authRateLimit, 15);

  router.post('/signup', credentialsLimiter, async (req, res) => {
    const input = parse(signupSchema, req.body);
    res.status(201).json(await signup(prisma, config.jwtSecret, input));
  });

  router.post('/login', credentialsLimiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    res.json(await login(prisma, config.jwtSecret, input));
  });

  router.post('/demo', demoLimiter, async (_req, res) => {
    if (!config.demo.enabled) throw new AppError('NOT_FOUND', 'Demo mode is disabled');
    res.status(201).json(await createGuest(prisma, config));
  });

  router.get('/me', requireAuth(prisma, config.jwtSecret), (req, res) => {
    res.json({ user: toUserDTO(currentUser(req)) });
  });

  return router;
}
