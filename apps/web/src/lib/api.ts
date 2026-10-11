import type { ApiErrorBody, ErrorCode } from '@flowsync/shared';
import { API_URL } from '../env';
import { trackSlow } from './waking';

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'flowsync.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage can be unavailable (private mode); the session then lasts one tab.
    }
  },
};

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

/** Cold starts on Render surface as 502/503/504 or dropped connections. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_BUDGET_MS = 75_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

let requestCounter = 0;

/**
 * JSON request to the API with the bearer token. Retries while the server is
 * waking up, flags slow requests for the "waking server" banner, and turns
 * error bodies into ApiError.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const key = `http-${++requestCounter}`;

  return trackSlow(key, async () => {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const token = tokenStore.get();
      let res: Response;
      try {
        res = await fetch(`${API_URL}${path}`, {
          method,
          signal,
          headers: {
            accept: 'application/json',
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (Date.now() - started < RETRY_BUDGET_MS) {
          await sleep(Math.min(1_000 * 2 ** attempt, 5_000));
          continue;
        }
        throw new ApiError(
          0,
          'NETWORK',
          'Cannot reach the FlowSync server. Check your connection.',
        );
      }

      if (RETRYABLE_STATUS.has(res.status) && Date.now() - started < RETRY_BUDGET_MS) {
        await sleep(Math.min(1_000 * 2 ** attempt, 5_000));
        continue;
      }
      if (res.status === 204) return undefined as T;

      const payload: unknown = await res.json().catch(() => null);
      if (res.ok) return payload as T;

      const error = (payload as ApiErrorBody | null)?.error;
      if (res.status === 401 && token) onUnauthorized();
      throw new ApiError(
        res.status,
        error?.code ?? 'INTERNAL',
        error?.message ?? `Request failed (${res.status})`,
        error?.fields,
      );
    }
  });
}

/** Fire-and-forget wake-up call so a sleeping server starts booting immediately. */
export function warmUp(): void {
  void fetch(`${API_URL}/health`).catch(() => undefined);
}
