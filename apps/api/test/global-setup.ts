import { execSync } from 'node:child_process';
import { assertTestDatabase, TEST_DATABASE_URL } from './env.js';

/**
 * Bring the test database schema up to date. Non-destructive: each test file
 * truncates the tables it uses (see resetDatabase()).
 */
export default function setup(): void {
  assertTestDatabase(TEST_DATABASE_URL);
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
  });
}
