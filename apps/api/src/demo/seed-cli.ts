import { loadConfig } from '../config.js';
import { createPrisma } from '../db.js';
import { ensureDemoWorkspace } from './demo.js';

/** `pnpm db:seed`: replace the demo workspace with a fresh copy. */
const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);

try {
  const result = await ensureDemoWorkspace(prisma, { force: true });
  console.info(`Demo workspace seeded (${result.workspaceId}).`);
} finally {
  await prisma.$disconnect();
}
