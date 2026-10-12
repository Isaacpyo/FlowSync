import { describe, expect, it } from 'vitest';
import {
  compareKeys,
  generateKeyBetween,
  generateNKeysBetween,
  isValidOrderKey,
} from '../src/fractional-index.js';

describe('generateKeyBetween', () => {
  it.each([
    [null, null, 'a0'],
    [null, 'a0', 'Zz'],
    [null, 'Zz', 'Zy'],
    ['a0', null, 'a1'],
    ['a1', null, 'a2'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
    ['Zz', 'a1', 'a0'],
    [null, 'Y00', 'Xzzz'],
    ['bzz', null, 'c000'],
    ['a0', 'a0V', 'a0G'],
    ['a0', 'a0G', 'a08'],
    ['b125', 'b129', 'b127'],
    ['a0', 'a1V', 'a1'],
    ['Zz', 'a01', 'a0'],
    [null, 'a0V', 'a0'],
    [null, 'b999', 'b99'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzy', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzz', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzV'],
  ])('between(%s, %s) = %s', (a, b, expected) => {
    expect(generateKeyBetween(a, b)).toBe(expected);
  });

  it.each([
    ['a1', 'a0'],
    ['a0', 'a0'],
    ['a00', null],
    [null, 'A00000000000000000000000000'],
    ['a0', 'a10'],
    ['', null],
    ['!', null],
  ])('rejects invalid input (%s, %s)', (a, b) => {
    expect(() => generateKeyBetween(a, b)).toThrow();
  });

  it('always lands strictly between its bounds (randomised)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const keys: string[] = [generateKeyBetween(null, null)];
    for (let i = 0; i < 2_000; i++) {
      const index = Math.floor(random() * (keys.length + 1));
      const lower = keys[index - 1] ?? null;
      const upper = keys[index] ?? null;
      const key = generateKeyBetween(lower, upper);
      if (lower !== null) expect(compareKeys(lower, key)).toBe(-1);
      if (upper !== null) expect(compareKeys(key, upper)).toBe(-1);
      expect(isValidOrderKey(key)).toBe(true);
      keys.splice(index, 0, key);
    }
    expect([...keys].sort(compareKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps keys short when appending', () => {
    let key: string | null = null;
    for (let i = 0; i < 10_000; i++) key = generateKeyBetween(key, null);
    expect(key!.length).toBeLessThanOrEqual(4);
  });

  it('grows keys slowly under repeated inserts into the same gap', () => {
    // Worst case for fractional indexing: always insert right after the same item.
    const head = 'a0';
    let upper = generateKeyBetween(head, null);
    for (let i = 0; i < 1_000; i++) upper = generateKeyBetween(head, upper);
    expect(upper.length).toBeLessThan(200);
  });
});

describe('generateNKeysBetween', () => {
  it.each([
    [null, null, 5],
    ['a0', null, 7],
    [null, 'a0', 7],
    ['a0', 'a1', 25],
  ])('generates %s..%s × %i sorted unique keys', (a, b, n) => {
    const keys = generateNKeysBetween(a, b, n);
    expect(keys).toHaveLength(n);
    expect([...keys].sort(compareKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(n);
    if (a !== null) expect(compareKeys(a, keys[0]!)).toBe(-1);
    if (b !== null) expect(compareKeys(keys[n - 1]!, b)).toBe(-1);
  });

  it('returns an empty list for n = 0', () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
  });
});

describe('compareKeys', () => {
  it('compares byte-wise, so uppercase sorts before lowercase', () => {
    // A locale-aware sort (Postgres default collation, localeCompare) gets this wrong.
    expect(compareKeys('Zz', 'a0')).toBe(-1);
    expect(['a0', 'Zz', 'a0V', 'A1'].sort(compareKeys)).toEqual(['A1', 'Zz', 'a0', 'a0V']);
  });
});
