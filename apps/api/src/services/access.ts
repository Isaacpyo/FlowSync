import type { Role } from '@flowsync/shared';
import type { Board, Workspace } from '@prisma/client';
import type { Db, Tx } from '../db.js';
import { forbidden, invalid, notFound } from '../errors.js';

/**
 * Authorisation lives here. A board or workspace the user is not a member of
 * is reported as "not found" rather than "forbidden", so ids cannot be probed.
 */

export async function requireWorkspaceRole(
  db: Db | Tx,
  userId: string,
  workspaceId: string,
  required: Role = 'MEMBER',
): Promise<{ workspace: Workspace; role: Role }> {
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) throw notFound('Workspace');
  if (required === 'OWNER' && membership.role !== 'OWNER') {
    throw forbidden('Only the workspace owner can do that');
  }
  return { workspace: membership.workspace, role: membership.role };
}

export async function requireBoardAccess(
  db: Db | Tx,
  userId: string,
  boardId: string,
  required: Role = 'MEMBER',
): Promise<{ board: Board & { workspace: Workspace }; role: Role }> {
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: { workspace: { include: { members: { where: { userId } } } } },
  });
  const membership = board?.workspace.members[0];
  if (!board || !membership) throw notFound('Board');
  if (required === 'OWNER' && membership.role !== 'OWNER') {
    throw forbidden('Only the workspace owner can do that');
  }
  const { members: _members, ...workspace } = board.workspace;
  return { board: { ...board, workspace }, role: membership.role };
}

/** Assignees must belong to the board's workspace. */
export async function requireAssignableUser(
  db: Db | Tx,
  boardId: string,
  userId: string,
): Promise<void> {
  const board = await db.board.findUnique({
    where: { id: boardId },
    select: { workspace: { select: { members: { where: { userId }, select: { userId: true } } } } },
  });
  if (!board || board.workspace.members.length === 0) {
    throw invalid('Assignee must be a member of this workspace', {
      assigneeId: 'Not a workspace member',
    });
  }
}

/**
 * Membership filter for member lists. The demo workspace collects a guest
 * account per visitor, so guests are hidden unless they are the viewer or
 * (for a board) assigned to one of its tasks.
 */
export function visibleMembers(viewerId: string, boardId?: string) {
  return {
    OR: [
      { user: { isGuest: false } },
      { userId: viewerId },
      ...(boardId ? [{ user: { assignedTasks: { some: { boardId } } } }] : []),
    ],
  };
}
