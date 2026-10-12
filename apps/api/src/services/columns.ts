import {
  positionAtEnd,
  resolvePosition,
  sortByPosition,
  type ActivityDTO,
  type ColumnDTO,
  type columnCreateSchema,
  type columnDeleteSchema,
  type columnMoveSchema,
  type columnUpdateSchema,
} from '@flowsync/shared';
import type { z } from 'zod';
import type { Db } from '../db.js';
import { transaction } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { logActivity } from './activity.js';
import { lockBoard } from './locks.js';
import { toColumnDTO } from './mappers.js';

export type ColumnCreate = z.output<typeof columnCreateSchema>;
export type ColumnUpdate = z.output<typeof columnUpdateSchema>;
export type ColumnMove = z.output<typeof columnMoveSchema>;
export type ColumnDelete = z.output<typeof columnDeleteSchema>;

export interface ColumnResult {
  column: ColumnDTO;
  activity: ActivityDTO | null;
}

const MAX_COLUMNS = 20;

export async function createColumn(
  db: Db,
  actorId: string,
  input: ColumnCreate,
): Promise<ColumnResult> {
  const { boardId, column } = input;
  return transaction(db, async (tx) => {
    const existing = await tx.column.findUnique({ where: { id: column.id } });
    if (existing) {
      if (existing.boardId !== boardId) throw conflict('Column id already in use');
      return { column: toColumnDTO(existing), activity: null };
    }
    await lockBoard(tx, boardId);
    const siblings = await tx.column.findMany({
      where: { boardId },
      select: { id: true, position: true },
    });
    if (siblings.length >= MAX_COLUMNS)
      throw conflict(`A board can have at most ${MAX_COLUMNS} columns`);
    const created = await tx.column.create({
      data: {
        id: column.id,
        boardId,
        name: column.name,
        position: positionAtEnd(sortByPosition(siblings)),
      },
    });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'column.created',
      data: { columnId: created.id, columnName: created.name },
    });
    return { column: toColumnDTO(created), activity };
  });
}

export async function renameColumn(
  db: Db,
  actorId: string,
  input: ColumnUpdate,
): Promise<ColumnResult> {
  const { boardId, columnId, name } = input;
  return transaction(db, async (tx) => {
    const current = await tx.column.findFirst({ where: { id: columnId, boardId } });
    if (!current) throw notFound('Column');
    if (current.name === name) return { column: toColumnDTO(current), activity: null };
    const updated = await tx.column.update({ where: { id: columnId }, data: { name } });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'column.renamed',
      data: { columnId, from: current.name, to: name },
    });
    return { column: toColumnDTO(updated), activity };
  });
}

export async function moveColumn(
  db: Db,
  actorId: string,
  input: ColumnMove,
): Promise<ColumnResult> {
  const { boardId, columnId, afterId, beforeId } = input;
  return transaction(db, async (tx) => {
    await lockBoard(tx, boardId);
    const current = await tx.column.findFirst({ where: { id: columnId, boardId } });
    if (!current) throw notFound('Column');
    const siblings = await tx.column.findMany({
      where: { boardId, id: { not: columnId } },
      select: { id: true, position: true },
    });
    const position = resolvePosition(sortByPosition(siblings), { afterId, beforeId });
    const updated = await tx.column.update({ where: { id: columnId }, data: { position } });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'column.moved',
      data: { columnId, columnName: updated.name },
    });
    return { column: toColumnDTO(updated), activity };
  });
}

export async function deleteColumn(
  db: Db,
  actorId: string,
  input: ColumnDelete,
): Promise<{ columnId: string; taskIds: string[]; activity: ActivityDTO }> {
  const { boardId, columnId } = input;
  return transaction(db, async (tx) => {
    await lockBoard(tx, boardId);
    const column = await tx.column.findFirst({
      where: { id: columnId, boardId },
      include: { tasks: { select: { id: true } } },
    });
    if (!column) throw notFound('Column');
    await tx.column.delete({ where: { id: columnId } });
    const activity = await logActivity(tx, {
      boardId,
      actorId,
      type: 'column.deleted',
      data: { columnId, columnName: column.name },
    });
    return { columnId, taskIds: column.tasks.map((t) => t.id), activity };
  });
}
