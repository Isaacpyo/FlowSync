/**
 * Fractional indexing: order keys are strings that sort lexicographically
 * (byte-wise, i.e. JS `<` / Postgres `COLLATE "C"`), and there is always room
 * to generate a new key between any two existing keys. Moving an item rewrites
 * only that item's key; siblings are never renumbered.
 *
 * Key format (after David Greenspan, "Implementing Fractional Indexing",
 * https://observablehq.com/@dgreensp/implementing-fractional-indexing):
 *
 *   key = integer part + fractional part
 *
 * - The integer part's first character encodes its own length: 'a'..'z' are
 *   non-negative integers of 2..27 characters, 'A'..'Z' negative ones of
 *   27..2 characters. Appending at either end therefore usually just
 *   increments or decrements a short integer and keeps keys short.
 * - The fractional part is a base-62 fraction without trailing zeros, used
 *   only when two keys share an integer part and something must fit between.
 */

export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const ZERO = BASE_62_DIGITS[0] as string;
const LAST = BASE_62_DIGITS[BASE_62_DIGITS.length - 1] as string;
/** The smallest possible integer part. Using it bare would leave no room below. */
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

export class FractionalIndexError extends Error {
  override name = 'FractionalIndexError';
}

function digitValue(char: string): number {
  const value = BASE_62_DIGITS.indexOf(char);
  if (value === -1) throw new FractionalIndexError(`invalid digit: ${char}`);
  return value;
}

function digitAt(value: number): string {
  const char = BASE_62_DIGITS[value];
  if (char === undefined) throw new FractionalIndexError(`digit out of range: ${value}`);
  return char;
}

/** Compare two order keys the way Postgres `COLLATE "C"` does. */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Midpoint of two fractional parts `a < b` (b === null means "1.0").
 * Neither may have trailing zeros.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new FractionalIndexError(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new FractionalIndexError('trailing zero');
  }

  if (b !== null) {
    // Strip the common prefix (padding `a` with zeros) and recurse on the rest.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  // First digits differ.
  const digitA = a.length > 0 ? digitValue(a[0] as string) : 0;
  const digitB = b !== null ? digitValue(b[0] as string) : BASE_62_DIGITS.length;
  if (digitB - digitA > 1) {
    return digitAt(Math.round((digitA + digitB) / 2));
  }
  // Consecutive first digits.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  // `b` is null or a single digit: keep a's first digit and go one level deeper.
  return digitAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new FractionalIndexError(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0] ?? '');
  if (length > key.length) throw new FractionalIndexError(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0] ?? '')) {
    throw new FractionalIndexError(`invalid integer part of order key: ${int}`);
  }
}

/** Throws if `key` is not a well-formed order key. */
export function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new FractionalIndexError(`invalid order key: ${key}`);
  const int = integerPart(key);
  const fraction = key.slice(int.length);
  if (fraction.endsWith(ZERO)) throw new FractionalIndexError(`invalid order key: ${key}`);
  for (const char of key.slice(1)) digitValue(char);
}

export function isValidOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Next integer, or null if `int` is already the largest representable one. */
function incrementInteger(int: string): string | null {
  validateInteger(int);
  const head = int[0] as string;
  const digits = int.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = digitValue(digits[i] as string) + 1;
    if (next === BASE_62_DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = digitAt(next);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

/** Previous integer, or null if `int` is already the smallest representable one. */
function decrementInteger(int: string): string | null {
  validateInteger(int);
  const head = int[0] as string;
  const digits = int.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const prev = digitValue(digits[i] as string) - 1;
    if (prev === -1) {
      digits[i] = LAST;
    } else {
      digits[i] = digitAt(prev);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + LAST;
  if (head === 'A') return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < 'Z') digits.push(LAST);
  else digits.pop();
  return prevHead + digits.join('');
}

/**
 * Generate a key strictly between `a` and `b`.
 * `null` means "no bound": `(null, b)` is before b, `(a, null)` after a,
 * `(null, null)` is the first key of an empty list.
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) throw new FractionalIndexError(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return 'a' + ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const decremented = decrementInteger(intB);
    if (decremented === null) throw new FractionalIndexError('cannot decrement any more');
    return decremented;
  }

  if (b === null) {
    const intA = integerPart(a);
    const fracA = a.slice(intA.length);
    const incremented = incrementInteger(intA);
    return incremented === null ? intA + midpoint(fracA, null) : incremented;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const incremented = incrementInteger(intA);
  if (incremented === null) throw new FractionalIndexError('cannot increment any more');
  if (incremented < b) return incremented;
  return intA + midpoint(fracA, null);
}

/**
 * Generate `n` evenly spread keys between `a` and `b` (used for seeding and
 * bulk inserts). Splitting recursively keeps the keys short.
 */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let current = generateKeyBetween(a, b);
    const keys = [current];
    for (let i = 0; i < n - 1; i++) {
      current = generateKeyBetween(current, b);
      keys.push(current);
    }
    return keys;
  }
  if (a === null) {
    let current = generateKeyBetween(a, b);
    const keys = [current];
    for (let i = 0; i < n - 1; i++) {
      current = generateKeyBetween(a, current);
      keys.push(current);
    }
    return keys.reverse();
  }
  const mid = Math.floor(n / 2);
  const middle = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, middle, mid),
    middle,
    ...generateNKeysBetween(middle, b, n - mid - 1),
  ];
}
