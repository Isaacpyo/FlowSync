import {
  generateNKeysBetween,
  type BoardSummaryDTO,
  type CreateBoardInput,
  type MemberDTO,
  type WorkspaceDetailDTO,
  type WorkspaceDTO,
} from '@flowsync/shared';
import type { Board, Role, Workspace } from '@prisma/client';
import type { Db } from '../db.js';
import { transaction } from '../db.js';
import { AppError, conflict } from '../errors.js';
import { requireWorkspaceRole, visibleMembers } from './access.js';
import { logActivity } from './activity.js';
import { toMemberDTO } from './mappers.js';

export const DEFAULT_COLUMNS = ['To do', 'In progress', 'Done'];

type WorkspaceWithCounts = Workspace & { _count: { members: number; boards: number } };

function toWorkspaceDTO(workspace: WorkspaceWithCounts, role: Role): WorkspaceDTO {
  return {
    id: workspace.id,
    name: workspace.name,
    isDemo: workspace.isDemo,
    role,
    memberCount: workspace._count.members,
    boardCount: workspace._count.boards,
  };
}

function toBoardSummary(board: Board & { _count: { tasks: number } }): BoardSummaryDTO {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    name: board.name,
    description: board.description,
    taskCount: board._count.tasks,
    updatedAt: board.updatedAt.toISOString(),
  };
}

const counts = { _count: { select: { members: true, boards: true } } } as const;

export async function listWorkspaces(db: Db, userId: string): Promise<WorkspaceDTO[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: { include: counts } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => toWorkspaceDTO(m.workspace, m.role));
}

export async function createWorkspace(db: Db, userId: string, name: string): Promise<WorkspaceDTO> {
  const workspace = await db.workspace.create({
    data: { name, members: { create: { userId, role: 'OWNER' } } },
    include: counts,
  });
  return toWorkspaceDTO(workspace, 'OWNER');
}

export async function getWorkspaceDetail(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDetailDTO> {
  const { role } = await requireWorkspaceRole(db, userId, workspaceId);
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      ...counts,
      members: {
        where: visibleMembers(userId),
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      },
      boards: { include: { _count: { select: { tasks: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  return {
    workspace: toWorkspaceDTO(workspace, role),
    members: workspace.members.map(toMemberDTO),
    boards: workspace.boards.map(toBoardSummary),
  };
}

export async function deleteWorkspace(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<{ boardIds: string[] }> {
  const { workspace } = await requireWorkspaceRole(db, userId, workspaceId, 'OWNER');
  if (workspace.isDemo) throw conflict('The demo workspace cannot be deleted');
  const boards = await db.board.findMany({ where: { workspaceId }, select: { id: true } });
  await db.workspace.delete({ where: { id: workspaceId } });
  return { boardIds: boards.map((b) => b.id) };
}

export async function inviteMember(
  db: Db,
  userId: string,
  workspaceId: string,
  email: string,
): Promise<MemberDTO> {
  await requireWorkspaceRole(db, userId, workspaceId, 'OWNER');
  const invitee = await db.user.findUnique({ where: { email } });
  if (!invitee || invitee.isGuest)
    throw new AppError('NOT_FOUND', 'No FlowSync account uses that email');
  const existing = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: invitee.id, workspaceId } },
  });
  if (existing) throw conflict(`${invitee.name} is already a member`);
  const membership = await db.membership.create({
    data: { userId: invitee.id, workspaceId, role: 'MEMBER' },
    include: { user: true },
  });
  return toMemberDTO(membership);
}

export async function createBoard(
  db: Db,
  userId: string,
  workspaceId: string,
  input: Required<CreateBoardInput>,
): Promise<BoardSummaryDTO> {
  await requireWorkspaceRole(db, userId, workspaceId);
  return transaction(db, async (tx) => {
    const keys = generateNKeysBetween(null, null, DEFAULT_COLUMNS.length);
    const board = await tx.board.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        columns: {
          create: DEFAULT_COLUMNS.map((name, i) => ({ name, position: keys[i] as string })),
        },
      },
      include: { _count: { select: { tasks: true } } },
    });
    await logActivity(tx, {
      boardId: board.id,
      actorId: userId,
      type: 'board.created',
      data: { boardName: board.name },
    });
    return toBoardSummary(board);
  });
}
