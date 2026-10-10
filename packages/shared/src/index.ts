export * from './activity.js';
export * from './events.js';
export * from './fractional-index.js';
export * from './ordering.js';
export * from './schemas.js';
export * from './types.js';

/** Palette for user avatars and live cursors. Readable on light and dark backgrounds. */
export const AVATAR_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
] as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
