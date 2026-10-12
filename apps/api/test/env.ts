export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/flowsync_test';

/** The cross-instance adapter test runs only when a Redis URL is provided (CI provides one). */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL || undefined;

/**
 * The suite truncates every table. Refuse to touch a database whose name does
 * not say it is for tests, so a mis-set variable cannot wipe real data.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}": its name must contain "test".`,
    );
  }
}
