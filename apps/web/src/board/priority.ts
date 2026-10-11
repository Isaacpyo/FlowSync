import type { Priority } from '@flowsync/shared';

export const PRIORITY_META: Record<Priority, { label: string; badge: string; dot: string }> = {
  LOW: {
    label: 'Low',
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  MEDIUM: {
    label: 'Medium',
    badge: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  HIGH: {
    label: 'High',
    badge: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  URGENT: {
    label: 'Urgent',
    badge: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    dot: 'bg-red-500',
  },
};
