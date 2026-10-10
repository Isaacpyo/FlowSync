import { compareKeys, generateKeyBetween } from './fractional-index.js';

export interface Positioned {
  id: string;
  position: string;
}

/**
 * Where the user wants an item to go, expressed relative to the neighbours
 * they saw when they dropped it.
 *
 * - `afterId`: the item directly above / left of the drop point,
 *   or `null` if it was dropped at the start.
 * - `beforeId`: the item directly below / right of the drop point,
 *   or `null` if it was dropped at the end.
 *
 * Sending intent instead of a precomputed key lets the server re-resolve the
 * position against the *current* order when other people changed the list in
 * the meantime.
 */
export interface PlacementIntent {
  afterId: string | null;
  beforeId: string | null;
}

/** Sort by position (byte-wise, like Postgres `COLLATE "C"`), ties broken by id. */
export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort((x, y) => compareKeys(x.position, y.position) || compareKeys(x.id, y.id));
}

/**
 * Resolve a placement intent against the current, sorted sibling list
 * (which must not contain the item being placed) and return a new key.
 *
 * Rules, in order:
 * 1. `afterId` still exists → place directly after it (between it and its
 *    current successor). Wins even if something was inserted between the
 *    two anchors since the client looked.
 * 2. `beforeId` still exists → place directly before it.
 * 3. Neither anchor exists. If the client meant "at the start" (`afterId`
 *    was null), place first; otherwise place last.
 */
export function resolvePosition(
  sortedSiblings: readonly Positioned[],
  intent: PlacementIntent,
): string {
  const { afterId, beforeId } = intent;

  if (afterId !== null) {
    const index = sortedSiblings.findIndex((s) => s.id === afterId);
    if (index !== -1) {
      const lower = sortedSiblings[index] as Positioned;
      const upper = sortedSiblings[index + 1] ?? null;
      return generateKeyBetween(lower.position, upper?.position ?? null);
    }
  }

  if (beforeId !== null) {
    const index = sortedSiblings.findIndex((s) => s.id === beforeId);
    if (index !== -1) {
      const upper = sortedSiblings[index] as Positioned;
      const lower = sortedSiblings[index - 1] ?? null;
      return generateKeyBetween(lower?.position ?? null, upper.position);
    }
  }

  const first = sortedSiblings[0] ?? null;
  const last = sortedSiblings[sortedSiblings.length - 1] ?? null;
  if (afterId === null && beforeId !== null) {
    return generateKeyBetween(null, first?.position ?? null);
  }
  return generateKeyBetween(last?.position ?? null, null);
}

/**
 * The placement intent for dropping an item at `index` of a list of ids
 * that does not contain the item itself.
 */
export function intentAt(idsWithoutItem: readonly string[], index: number): PlacementIntent {
  const clamped = Math.max(0, Math.min(index, idsWithoutItem.length));
  return {
    afterId: idsWithoutItem[clamped - 1] ?? null,
    beforeId: idsWithoutItem[clamped] ?? null,
  };
}

/** Key for appending after the last item of a sorted list. */
export function positionAtEnd(sortedItems: readonly Positioned[]): string {
  const last = sortedItems[sortedItems.length - 1];
  return generateKeyBetween(last?.position ?? null, null);
}
