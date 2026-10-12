import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { ensureDemoWorkspace, pruneGuests } from './demo/demo.js';
import { createLogger } from './logger.js';
import { createFlowSyncServer } from './server.js';

const config = loadConfig();
const logger = createLogger(config);
const prisma = createPrisma(config.databaseUrl);

async function main(): Promise<void> {
  await prisma.$connect();

  let pruneTimer: NodeJS.Timeout | undefined;
  if (config.demo.enabled) {
    // On Render's free tier the instance sleeps when idle, so boots are
    // frequent; a stale demo workspace gets a fresh copy on the next boot.
    const demo = await ensureDemoWorkspace(prisma, { resetAfterHours: config.demo.resetHours });
    logger.info(demo, demo.seeded ? 'demo workspace seeded' : 'demo workspace is fresh');
    const prune = () =>
      pruneGuests(prisma)
        .then((count) => count > 0 && logger.info({ count }, 'pruned expired guests'))
        .catch((err) => logger.error({ err }, 'guest pruning failed'));
    await prune();
    pruneTimer = setInterval(prune, 60 * 60 * 1000);
    pruneTimer.unref();
  }

  const server = createFlowSyncServer({ config, prisma, logger });
  server.httpServer.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, redis: Boolean(config.redisUrl) },
      'FlowSync API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(pruneTimer);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (err) => {
  logger.fatal({ err }, 'failed to start');
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
