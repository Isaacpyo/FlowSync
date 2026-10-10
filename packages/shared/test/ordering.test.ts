import { describe, expect, it } from 'vitest';
import { compareKeys, generateNKeysBetween } from '../src/fractional-index.js';
import {
  intentAt,
  positionAtEnd,
  resolvePosition,
  sortByPosition,
  type Positioned,
} from '../src/ordering.js';

function list(...ids: string[]): Positioned[] {
  const keys = generateNKeysBetween(null, null, ids.length);
  return ids.map((id, i) => ({ id, position: keys[i]! }));
}

/** Insert an item with the resolved key and return the resulting id order. */
function orderAfterInsert(siblings: Positioned[], id: string, position: string): string[] {
  return sortByPosition([...siblings, { id, position }]).map((s) => s.id);
}

describe('resolvePosition', () => {
  const siblings = list('A', 'B', 'C');

  it('places between the two anchors when they are still adjacent', () => {
    const key = resolvePosition(siblings, { afterId: 'A', beforeId: 'B' });
    expect(orderAfterInsert(siblings, 'X', key)).toEqual(['A', 'X', 'B', 'C']);
  });

  it('places at the start and the end', () => {
    const start = resolvePosition(siblings, { afterId: null, beforeId: 'A' });
    expect(orderAfterInsert(siblings, 'X', start)).toEqual(['X', 'A', 'B', 'C']);
    const end = resolvePosition(siblings, { afterId: 'C', beforeId: null });
    expect(orderAfterInsert(siblings, 'X', end)).toEqual(['A', 'B', 'C', 'X']);
  });

  it('places into an empty list', () => {
    expect(resolvePosition([], { afterId: null, beforeId: null })).toBe('a0');
  });

  it('stays directly after the "after" anchor when someone inserted between the anchors', () => {
    // Client saw A,B and dropped between them; meanwhile Y was inserted there.
    const changed = sortByPosition([
      ...siblings,
      { id: 'Y', position: resolvePosition(siblings, { afterId: 'A', beforeId: 'B' }) },
    ]);
    const key = resolvePosition(changed, { afterId: 'A', beforeId: 'B' });
    expect(orderAfterInsert(changed, 'X', key)).toEqual(['A', 'X', 'Y', 'B', 'C']);
  });

  it('falls back to the "before" anchor when the "after" anchor was moved away', () => {
    const withoutA = siblings.filter((s) => s.id !== 'A');
    const key = resolvePosition(withoutA, { afterId: 'A', beforeId: 'C' });
    expect(orderAfterInsert(withoutA, 'X', key)).toEqual(['B', 'X', 'C']);
  });

  it('honours "at the start" when its only anchor disappeared', () => {
    const withoutA = siblings.filter((s) => s.id !== 'A');
    const key = resolvePosition(withoutA, { afterId: null, beforeId: 'A' });
    expect(orderAfterInsert(withoutA, 'X', key)).toEqual(['X', 'B', 'C']);
  });

  it('appends when both anchors disappeared', () => {
    const onlyC = siblings.filter((s) => s.id === 'C');
    const key = resolvePosition(onlyC, { afterId: 'A', beforeId: 'B' });
    expect(orderAfterInsert(onlyC, 'X', key)).toEqual(['C', 'X']);
  });

  it('serialised concurrent drops into the same gap never collide', () => {
    // Ten clients all saw A,B and dropped a task between them. The server
    // processes them one at a time (column row lock) against the live list.
    let current = list('A', 'B');
    for (let i = 0; i < 10; i++) {
      const key = resolvePosition(current, { afterId: 'A', beforeId: 'B' });
      current = sortByPosition([...current, { id: `T${i}`, position: key }]);
    }
    const positions = current.map((s) => s.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(current[0]!.id).toBe('A');
    expect(current[current.length - 1]!.id).toBe('B');
  });
});

describe('intentAt', () => {
  it('maps a drop index to neighbour ids', () => {
    expect(intentAt(['A', 'B', 'C'], 0)).toEqual({ afterId: null, beforeId: 'A' });
    expect(intentAt(['A', 'B', 'C'], 2)).toEqual({ afterId: 'B', beforeId: 'C' });
    expect(intentAt(['A', 'B', 'C'], 3)).toEqual({ afterId: 'C', beforeId: null });
    expect(intentAt(['A', 'B', 'C'], 99)).toEqual({ afterId: 'C', beforeId: null });
    expect(intentAt([], 0)).toEqual({ afterId: null, beforeId: null });
  });
});

describe('sortByPosition / positionAtEnd', () => {
  it('sorts byte-wise and breaks ties by id', () => {
    const sorted = sortByPosition([
      { id: 'b', position: 'a0' },
      { id: 'a', position: 'a0' },
      { id: 'c', position: 'Zz' },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends after the last item', () => {
    const items = list('A', 'B');
    expect(compareKeys(items[1]!.position, positionAtEnd(items))).toBe(-1);
    expect(positionAtEnd([])).toBe('a0');
  });
});
