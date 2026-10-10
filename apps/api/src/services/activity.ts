import type { ActivityData, ActivityDTO, ActivityType, Page, PageQuery } from '@flowsync/shared';
import type { Db, Tx } from '../db.js';
import { authorSelect, toActivityDTO } from './mappers.js';

export async function logActivity(
  tx: Tx | Db,
  entry: { boardId: string; actorId: string | null; type: ActivityType; data: ActivityData },
): Promise<ActivityDTO> {
  const activity = await tx.activity.create({
    data: {
      boardId: entry.boardId,
      actorId: entry.actorId,
      type: entry.type,
      data: entry.data as object,
    },
    include: { actor: { select: authorSelect } },
  });
  return toActivityDTO(activity);
}

/** Newest first, cursor = id of the last item of the previous page. */
export async function listActivity(
  db: Db,
  boardId: string,
  { before, limit }: PageQuery,
): Promise<Page<ActivityDTO>> {
  const rows = await db.activity.findMany({
    where: { boardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: { actor: { select: authorSelect } },
  });
  const items = rows.slice(0, limit).map(toActivityDTO);
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}
