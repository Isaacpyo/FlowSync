import type { Tx } from '../db.js';
import { notFound } from '../errors.js';

/**
 * Row locks that serialise writers touching the same ordered list.
 *
 * Every write that assigns a task position (create, move) first locks the
 * target column row; every write that assigns a column position locks the
 * board row. Concurrent drops into the same column therefore run one after
 * another, each one seeing the previous one's committed key, so two writers
 * can never derive the same key. Each transaction takes at most one of
 * these locks, so they cannot deadlock.
 */

export async function lockColumn(
  tx: Tx,
  boardId: string,
  columnId: string,
): Promise<{ id: string; name: string }> {
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "Column"
    WHERE id = ${columnId}::uuid AND "boardId" = ${boardId}::uuid
    FOR UPDATE`;
  const column = rows[0];
  if (!column) throw notFound('Column');
  return column;
}

export async function lockBoard(tx: Tx, boardId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Board" WHERE id = ${boardId}::uuid FOR UPDATE`;
  if (!rows[0]) throw notFound('Board');
}
