import { describe, expect, it } from 'vitest';
import { loadConfig, originMatcher } from '../src/config.js';
import { TokenBucket } from '../src/realtime/rate-limit.js';

describe('TokenBucket', () => {
  it('allows a burst, then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 1_000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now = 60_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('originMatcher', () => {
  const allow = originMatcher([
    'https://flowsync.temitopeagbola.com',
    'https://deploy-preview-*--flowsync.netlify.app',
  ]);

  it('matches exact origins and wildcards', () => {
    expect(allow('https://flowsync.temitopeagbola.com')).toBe(true);
    expect(allow('https://deploy-preview-42--flowsync.netlify.app')).toBe(true);
    expect(allow(undefined)).toBe(true); // same-origin / non-browser clients
  });

  it('rejects look-alikes', () => {
    expect(allow('https://flowsync.temitopeagbola.com.evil.dev')).toBe(false);
    expect(allow('https://evil.dev/https://flowsync.temitopeagbola.com')).toBe(false);
    expect(allow('https://deploy-preview-1--flowsync.netlify.app.evil.dev')).toBe(false);
    expect(allow('http://flowsync.temitopeagbola.com')).toBe(false);
  });
});

describe('loadConfig', () => {
  it('requires a JWT secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('treats empty values as unset and parses lists and booleans', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: '',
      REDIS_URL: '',
      CORS_ORIGIN: 'https://a.dev/, https://b.dev',
      DEMO_ENABLED: 'false',
    });
    expect(config.redisUrl).toBeUndefined();
    expect(config.corsOrigins).toEqual(['https://a.dev', 'https://b.dev']);
    expect(config.demo.enabled).toBe(false);
  });
});
