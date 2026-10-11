import { useEffect } from 'react';
import { create } from 'zustand';

export type Theme = 'light' | 'dark';
const KEY = 'flowsync.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeState {
  theme: Theme;
  /** True once the user picked a theme; until then we follow the OS. */
  explicit: boolean;
  toggle(): void;
  followSystem(theme: Theme): void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: typeof window === 'undefined' ? 'light' : initialTheme(),
  explicit: (() => {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  })(),
  toggle() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // ignore
    }
    set({ theme, explicit: true });
  },
  followSystem(theme) {
    if (!get().explicit) set({ theme });
  },
}));

/** Keep the <html> class in sync with the theme and follow OS changes. */
export function useThemeEffect(): void {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const listener = (e: MediaQueryListEvent) =>
      useTheme.getState().followSystem(e.matches ? 'dark' : 'light');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
}
