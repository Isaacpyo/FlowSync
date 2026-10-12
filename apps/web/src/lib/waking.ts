import { create } from 'zustand';

/**
 * Tracks "the server is probably asleep" moments. Render's free tier stops
 * idle instances; the first request then takes 30-60s while it boots. Any
 * request (or socket connection attempt) slower than SLOW_MS registers here
 * and the UI shows a friendly banner instead of looking frozen.
 */
export const SLOW_MS = 2_000;

interface WakingState {
  slow: Set<string>;
  since: number | null;
  markSlow(key: string): void;
  markDone(key: string): void;
}

export const useWaking = create<WakingState>((set) => ({
  slow: new Set(),
  since: null,
  markSlow: (key) =>
    set((state) => {
      if (state.slow.has(key)) return state;
      const slow = new Set(state.slow).add(key);
      return { slow, since: state.since ?? Date.now() };
    }),
  markDone: (key) =>
    set((state) => {
      if (!state.slow.has(key)) return state;
      const slow = new Set(state.slow);
      slow.delete(key);
      return { slow, since: slow.size > 0 ? state.since : null };
    }),
}));

/** Run `work`, flagging it as slow if it takes longer than SLOW_MS. */
export async function trackSlow<T>(key: string, work: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => useWaking.getState().markSlow(key), SLOW_MS);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
    useWaking.getState().markDone(key);
  }
}
