import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, tone?: ToastTone): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(message, tone = 'info') {
    const id = nextId++;
    // Collapse repeats of the same message.
    if (get().toasts.some((t) => t.message === message)) return;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, tone }] }));
    setTimeout(() => get().dismiss(id), tone === 'error' ? 6_000 : 3_500);
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = (message: string, tone?: ToastTone) =>
  useToasts.getState().push(message, tone);
