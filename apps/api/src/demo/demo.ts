import { randomUUID } from 'node:crypto';
import {
  generateNKeysBetween,
  type ActivityData,
  type ActivityType,
  type AuthResponse,
} from '@flowsync/shared';
import type { Prisma } from '@prisma/client';
import type { Config } from '../config.js';
import type { Db, Tx } from '../db.js';
import { authResponse, randomAvatarColor } from '../services/users.js';
import { guestName } from './names.js';
import { BOARDS, DEMO_WORKSPACE_NAME, TEAMMATES } from './seed-data.js';

/** Guests (and their access tokens) live this long. */
export const GUEST_TTL_HOURS = 24;
const DEMO_LOCK_KEY = 4_217_301; // pg advisory lock: one seeder at a time across instances
const HOUR = 60 * 60 * 1000;

export interface EnsureDemoOptions {
  /** Re-seed when the demo workspace is older than this. 0 = never. */
  resetAfterHours?: number;
  /** Re-seed unconditionally (seed CLI). */
  force?: boolean;
}

/**
 * Make sure the shared demo workspace exists and is reasonably fresh.
 * Visitors can edit and delete anything in it, so it is periodically
 * replaced with a pristine copy. Guests created within their TTL are
 * re-added to the new copy so their session keeps working.
 */
export async function ensureDemoWorkspace(
  prisma: Db,
  { resetAfterHours = 0, force = false }: EnsureDemoOptions = {},
): Promise<{ workspaceId: string; seeded: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_LOCK_KEY})`;
      const existing = await tx.workspace.findFirst({ where: { isDemo: true } });
      const stale =
        existing !== null &&
        resetAfterHours > 0 &&
        Date.now() - existing.createdAt.getTime() > resetAfterHours * HOUR;
      if (existing && !stale && !force) return { workspaceId: existing.id, seeded: false };

      await tx.workspace.deleteMany({ where: { isDemo: true } });
      const workspaceId = await seedDemoWorkspace(tx);
      const guests = await tx.user.findMany({
        where: { isGuest: true, createdAt: { gte: new Date(Date.now() - GUEST_TTL_HOURS * HOUR) } },
        select: { id: true },
      });
      if (guests.length > 0) {
        await tx.membership.createMany({
          data: guests.map((g) => ({ userId: g.id, workspaceId, role: 'MEMBER' as const })),
          skipDuplicates: true,
        });
      }
      return { workspaceId, seeded: true };
    },
    { timeout: 60_000, maxWait: 60_000 },
  );
}

/** "Try the demo": a fresh guest account that is a member of the demo workspace. */
export async function createGuest(
  prisma: Db,
  config: Pick<Config, 'jwtSecret'>,
): Promise<AuthResponse> {
  const { workspaceId } = await ensureDemoWorkspace(prisma);
  const guest = await prisma.user.create({
    data: {
      name: guestName(),
      email: `guest-${randomUUID()}@guest.flowsync.local`,
      isGuest: true,
      avatarColor: randomAvatarColor(),
      memberships: { create: { workspaceId, role: 'MEMBER' } },
    },
  });
  return authResponse(config.jwtSecret, guest);
}

/** Delete guests past their TTL. Their messages and activity stay, authorless. */
export async function pruneGuests(prisma: Db, maxAgeHours = GUEST_TTL_HOURS): Promise<number> {
  const { count } = await prisma.user.deleteMany({
    where: { isGuest: true, createdAt: { lt: new Date(Date.now() - maxAgeHours * HOUR) } },
  });
  return count;
}

async function seedDemoWorkspace(tx: Tx): Promise<string> {
  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);
  const daysFromNow = (days: number) => {
    const date = new Date(now + days * 24 * HOUR);
    return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
  };

  // Teammates are stable across resets.
  const users = new Map<string, string>();
  for (const mate of TEAMMATES) {
    const user = await tx.user.upsert({
      where: { email: mate.email },
      update: { name: mate.name, avatarColor: mate.avatarColor },
      create: { name: mate.name, email: mate.email, avatarColor: mate.avatarColor },
    });
    users.set(mate.key, user.id);
  }
  const userId = (key: string | undefined) => (key ? (users.get(key) ?? null) : null);

  const workspace = await tx.workspace.create({
    data: {
      name: DEMO_WORKSPACE_NAME,
      isDemo: true,
      members: {
        create: TEAMMATES.map((mate) => ({ userId: userId(mate.key) as string, role: mate.role })),
      },
    },
  });

  for (const [boardIndex, seed] of BOARDS.entries()) {
    const board = await tx.board.create({
      data: { workspaceId: workspace.id, name: seed.name, description: seed.description },
    });
    const columnKeys = generateNKeysBetween(null, null, seed.columns.length);
    const tasks: Prisma.TaskCreateManyInput[] = [];
    const activities: Prisma.ActivityCreateManyInput[] = [];
    const activity = (
      type: ActivityType,
      actor: string,
      data: ActivityData,
      at: Date,
    ): Prisma.ActivityCreateManyInput => ({
      boardId: board.id,
      actorId: userId(actor),
      type,
      data: data as object,
      createdAt: at,
    });

    const firstMinute = 3 * 24 * 60 - boardIndex * 600;
    activities.push(
      activity('board.created', 'ava', { boardName: board.name }, minutesAgo(firstMinute)),
    );

    let minute = firstMinute - 30;
    for (const [columnIndex, columnSeed] of seed.columns.entries()) {
      const column = await tx.column.create({
        data: {
          boardId: board.id,
          name: columnSeed.name,
          position: columnKeys[columnIndex] as string,
        },
      });
      const taskKeys = generateNKeysBetween(null, null, columnSeed.tasks.length);
      for (const [taskIndex, taskSeed] of columnSeed.tasks.entries()) {
        const id = randomUUID();
        const createdAt = minutesAgo(minute);
        tasks.push({
          id,
          boardId: board.id,
          columnId: column.id,
          title: taskSeed.title,
          description: taskSeed.description ?? '',
          priority: taskSeed.priority,
          assigneeId: userId(taskSeed.assignee),
          creatorId: userId('ava'),
          dueDate: taskSeed.dueInDays === undefined ? null : daysFromNow(taskSeed.dueInDays),
          position: taskKeys[taskIndex] as string,
          createdAt,
          updatedAt: createdAt,
        });
        const author = taskSeed.assignee ?? 'ava';
        activities.push(
          activity(
            'task.created',
            author,
            { taskId: id, taskTitle: taskSeed.title, columnName: 'Backlog' },
            createdAt,
          ),
        );
        if (columnIndex > 0 && columnSeed.name !== 'Backlog') {
          activities.push(
            activity(
              'task.moved',
              author,
              {
                taskId: id,
                taskTitle: taskSeed.title,
                fromColumn: 'Backlog',
                toColumn: columnSeed.name,
              },
              minutesAgo(minute - 45),
            ),
          );
        }
        minute -= 60;
      }
    }
    await tx.task.createMany({ data: tasks });
    await tx.activity.createMany({ data: activities });
    await tx.message.createMany({
      data: seed.messages.map((m) => ({
        boardId: board.id,
        authorId: userId(m.author),
        body: m.body,
        createdAt: minutesAgo(m.minutesAgo),
      })),
    });
  }

  return workspace.id;
}
