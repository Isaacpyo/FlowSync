import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke test against the real stack: the API (on its own
 * database) and a production build of the web app served by `vite preview`.
 */
const API_PORT = 4100;
const WEB_PORT = 4173;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/flowsync_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
  ],
  webServer: [
    {
      command:
        'pnpm --dir ../api exec prisma migrate deploy && pnpm --dir ../api exec tsx src/index.ts',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL,
        DIRECT_URL: DATABASE_URL,
        REDIS_URL: process.env.E2E_REDIS_URL ?? '',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        AUTH_RATE_LIMIT: '1000',
      },
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
