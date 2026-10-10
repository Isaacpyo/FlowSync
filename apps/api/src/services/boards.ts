import type { BoardDTO, MessageDTO, Page, PageQuery } from '@flowsync/shared';
import { sortByPosition } from '@flowsync/shared';
import type { Db } from '../db.js';
import { requireBoardAccess, visibleMembers } from './access.js';
import { authorSelect, toColumnDTO, toMemberDTO, toMessageDTO, toTaskDTO } from './mappers.js';

/** Full board snapshot: the client's starting point and its resync after reconnects. */
export async function getBoard(db: Db, userId: string, boardId: string): Promise<BoardDTO> {
  const { board, role } = await requireBoardAccess(db, userId, boardId);
  const [columns, tasks, members] = await Promise.all([
    db.column.findMany({ where: { boardId } }),
    db.task.findMany({ where: { boardId } }),
    db.membership.findMany({
      where: { workspaceId: board.workspaceId, ...visibleMembers(userId, boardId) },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    workspaceName: board.workspace.name,
    name: board.name,
    description: board.description,
    role,
    columns: sortByPosition(columns).map(toColumnDTO),
    tasks: sortByPosition(tasks).map(toTaskDTO),
    members: members.map(toMemberDTO),
  };
}

export async function deleteBoard(db: Db, userId: string, boardId: string): Promise<void> {
  await requireBoardAccess(db, userId, boardId, 'OWNER');
  await db.board.delete({ where: { id: boardId } });
}

export async function sendMessage(
  db: Db,
  authorId: string,
  boardId: string,
  body: string,
): Promise<MessageDTO> {
  const message = await db.message.create({
    data: { boardId, authorId, body },
    include: { author: { select: authorSelect } },
  });
  return toMessageDTO(message);
}

/** Chat history page: returns messages oldest → newest; cursor walks backwards. */
export async function listMessages(
  db: Db,
  boardId: string,
  { before, limit }: PageQuery,
): Promise<Page<MessageDTO>> {
  const rows = await db.message.findMany({
    where: { boardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: { author: { select: authorSelect } },
  });
  const page = rows.slice(0, limit);
  const oldest = page[page.length - 1];
  return {
    items: page.reverse().map(toMessageDTO),
    nextCursor: rows.length > limit && oldest ? oldest.id : null,
  };
}
