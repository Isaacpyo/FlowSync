import type { User } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.js';
import { unauthorized } from '../errors.js';
import { bearerToken, verifyToken } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Resolve a token to a live user. Deleted users (e.g. expired guests) are rejected. */
export async function authenticate(db: Db, secret: string, token: string | undefined) {
  const userId = verifyToken(secret, token);
  if (!userId) return null;
  return db.user.findUnique({ where: { id: userId } });
}

export function requireAuth(db: Db, secret: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = await authenticate(db, secret, bearerToken(req.headers.authorization));
    if (!user) throw unauthorized();
    req.user = user;
    next();
  };
}

/** For handlers mounted behind requireAuth. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
