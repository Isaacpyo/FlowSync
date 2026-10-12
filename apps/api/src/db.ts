import { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

const RETRYABLE = new Set([
  'P2002', // unique constraint (two writers derived the same position key)
  'P2034', // write conflict / deadlock
]);

/**
 * Run an interactive transaction, retrying a few times on errors that a
 * fresh attempt resolves (conflicts against a concurrent writer).
 */
export async function transaction<T>(
  prisma: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  { attempts = 3, timeout = 10_000 }: { attempts?: number; timeout?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout, maxWait: timeout });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(error.code);
      if (!retryable || attempt >= attempts) throw error;
    }
  }
}
