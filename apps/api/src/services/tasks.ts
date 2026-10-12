import {
  positionAtEnd,
  resolvePosition,
  sortByPosition,
  type ActivityDTO,
  type TaskDTO,
  type taskCreateSchema,
  type taskDeleteSchema,
  type taskMoveSchema,
  type taskUpdateSchema,
} from '@flowsync/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { Db } from '../db.js';
import { transaction } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { requireAssignableUser } from './access.js';
import { logActivity } from './activity.js';
import { lockColumn } from './locks.js';
import { fromDateOnly, toDateOnly, toTaskDTO } from './mappers.js';

export type TaskCreate = z.output<typeof taskCreateSchema>;
export type TaskUpdate = z.output<typeof taskUpdateSchema>;
export type TaskMove = z.output<typeof taskMoveSchema>;
export type TaskDelete = z.output<typeof taskDeleteSchema>;

export interface TaskResult {
  task: TaskDTO;
  activity: ActivityDTO | null;
}

/**
 * Task writes. Callers have already checked that the actor is a member of
 * `boardId`; every query here is additionally scoped to that board, so an id
 * from another board is simply "not found".
 */

export async function createTask(db: Db, actorId: string, input: TaskCreate): Promise<TaskResult> {
  const { boardId, task } = input;
  if (task.assigneeId) await requireAssignableUser(db, boardId, task.assigneeId);

  return transaction(db, async (tx) => {
    // Idempotent on the client-generated id: a retried create returns the original.
    const existing = await tx.task.findUnique({ where: { id: task.id } });
    if (existing) {
      if (existing.boardId !== boardId) throw conflict('Task id already in use');
      return { task: toTaskDTO(existing), activity: null };
    }

    const column = await lockColumn(tx, boardId, task.columnId);
    const siblings = await tx.task.findMany({
      where: { columnId: column.id },
      select: { id: true, position: true },
    });
    const created = await tx.task.create({
      data: {
        id: task.id,
        boardId,
        columnId: column.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        assigneeId: task.assigneeId,
        dueDate: fromDateOnly(task.dueDate),
        position: positionAtEnd(sortByPosition(siblings)),
        creatorId: actorId,
      },
    });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'task.created',
      data: { taskId: created.id, taskTitle: created.title, columnName: column.name },
    });
    return { task: toTaskDTO(created), activity };
  });
}

export async function updateTask(db: Db, actorId: string, input: TaskUpdate): Promise<TaskResult> {
  const { boardId, taskId, patch } = input;
  if (patch.assigneeId) await requireAssignableUser(db, boardId, patch.assigneeId);

  return transaction(db, async (tx) => {
    const current = await tx.task.findFirst({ where: { id: taskId, boardId } });
    if (!current) throw notFound('Task');

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changed: string[] = [];
    if (patch.title !== undefined && patch.title !== current.title) {
      data.title = patch.title;
      changed.push('title');
    }
    if (patch.description !== undefined && patch.description !== current.description) {
      data.description = patch.description;
      changed.push('description');
    }
    if (patch.priority !== undefined && patch.priority !== current.priority) {
      data.priority = patch.priority;
      changed.push('priority');
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== current.assigneeId) {
      data.assigneeId = patch.assigneeId;
      changed.push('assigneeId');
    }
    if (patch.dueDate !== undefined && patch.dueDate !== toDateOnly(current.dueDate)) {
      data.dueDate = fromDateOnly(patch.dueDate);
      changed.push('dueDate');
    }
    if (changed.length === 0) return { task: toTaskDTO(current), activity: null };

    // Field-level last-writer-wins: only the fields in the patch are written,
    // so concurrent edits to different fields of one task both survive.
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { ...data, version: { increment: 1 } },
    });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'task.updated',
      data: { taskId, taskTitle: updated.title, fields: changed },
    });
    return { task: toTaskDTO(updated), activity };
  });
}

/**
 * Move a task to `toColumnId`, positioned by intent (after/before anchors).
 * See resolvePosition() for how stale anchors are handled.
 */
export async function moveTask(db: Db, actorId: string, input: TaskMove): Promise<TaskResult> {
  const { boardId, taskId, toColumnId, afterId, beforeId } = input;

  return transaction(db, async (tx) => {
    const target = await lockColumn(tx, boardId, toColumnId);
    const task = await tx.task.findFirst({
      where: { id: taskId, boardId },
      include: { column: { select: { name: true } } },
    });
    if (!task) throw notFound('Task');

    const siblings = await tx.task.findMany({
      where: { columnId: target.id, id: { not: taskId } },
      select: { id: true, position: true },
    });
    const position = resolvePosition(sortByPosition(siblings), { afterId, beforeId });

    const moved = await tx.task.update({
      where: { id: taskId },
      data: { columnId: target.id, position, version: { increment: 1 } },
    });

    // Reordering inside a column is too noisy for the activity log.
    const activity =
      task.columnId === target.id
        ? null
        : await logActivity(tx, {
            boardId,
            actorId,
            type: 'task.moved',
            data: {
              taskId,
              taskTitle: moved.title,
              fromColumn: task.column.name,
              toColumn: target.name,
            },
          });
    return { task: toTaskDTO(moved), activity };
  });
}

export async function deleteTask(
  db: Db,
  actorId: string,
  input: TaskDelete,
): Promise<{ taskId: string; activity: ActivityDTO }> {
  const { boardId, taskId } = input;
  return transaction(db, async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, boardId } });
    if (!task) throw notFound('Task');
    await tx.task.delete({ where: { id: taskId } });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'task.deleted',
      data: { taskId, taskTitle: task.title },
    });
    return { taskId, activity };
  });
}
