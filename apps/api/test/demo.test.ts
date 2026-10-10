import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/db.js';
import { createGuest, ensureDemoWorkspace, pruneGuests } from '../src/demo/demo.js';
import { guestName } from '../src/demo/names.js';
import { BOARDS } from '../src/demo/seed-data.js';
import { TEST_DATABASE_URL } from './env.js';
import { resetDatabase, testConfig } from './helpers.js';

const prisma = createPrisma(TEST_DATABASE_URL);

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
beforeEach(() => resetDatabase(prisma));

describe('demo workspace', () => {
  it('seeds once and is idempotent while fresh', async () => {
    const first = await ensureDemoWorkspace(prisma, { resetAfterHours: 6 });
    expect(first.seeded).toBe(true);
    const second = await ensureDemoWorkspace(prisma, { resetAfterHours: 6 });
    expect(second).toEqual({ workspaceId: first.workspaceId, seeded: false });

    const boards = await prisma.board.findMany({
      where: { workspaceId: first.workspaceId },
      include: { _count: { select: { tasks: true, columns: true, messages: true } } },
    });
    expect(boards).toHaveLength(BOARDS.length);
    const expectedTasks = BOARDS.flatMap((b) => b.columns.flatMap((c) => c.tasks)).length;
    expect(boards.reduce((sum, b) => sum + b._count.tasks, 0)).toBe(expectedTasks);
  });

  it('re-seeds a stale workspace and keeps recent guests as members', async () => {
    const { workspaceId } = await ensureDemoWorkspace(prisma);
    const guest = await createGuest(prisma, testConfig());
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    });

    const reset = await ensureDemoWorkspace(prisma, { resetAfterHours: 6 });
    expect(reset.seeded).toBe(true);
    expect(reset.workspaceId).not.toBe(workspaceId);
    expect(await prisma.workspace.count({ where: { isDemo: true } })).toBe(1);
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: guest.user.id, workspaceId: reset.workspaceId } },
    });
    expect(membership?.role).toBe('MEMBER');
  });

  it('serialises concurrent seeding (advisory lock)', async () => {
    await Promise.all([
      ensureDemoWorkspace(prisma),
      ensureDemoWorkspace(prisma),
      ensureDemoWorkspace(prisma),
    ]);
    expect(await prisma.workspace.count({ where: { isDemo: true } })).toBe(1);
  });

  it('prunes guests past their TTL', async () => {
    const fresh = await createGuest(prisma, testConfig());
    const old = await createGuest(prisma, testConfig());
    await prisma.user.update({
      where: { id: old.user.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(await pruneGuests(prisma)).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: fresh.user.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: old.user.id } })).toBeNull();
  });

  it('generates friendly guest names', () => {
    expect(guestName(() => 0)).toBe('Swift Otter');
    expect(guestName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});
