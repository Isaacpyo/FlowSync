import type { ErrorCode } from '@flowsync/shared';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have access to this') =>
  new AppError('FORBIDDEN', message);
export const unauthorized = (message = 'Sign in to continue') =>
  new AppError('UNAUTHORIZED', message);
export const conflict = (message: string) => new AppError('CONFLICT', message);
export const invalid = (message: string, fields?: Record<string, string>) =>
  new AppError('VALIDATION', message, fields);
