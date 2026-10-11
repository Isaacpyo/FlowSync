import type { BoardView } from '@flowsync/shared';
import { useEffect } from 'react';
import { boardActions } from '../sync/board-store';

const SEND_EVERY_MS = 50;

/**
 * Broadcast this user's pointer over `el`, throttled to ~20 Hz with a
 * trailing update so the final resting position is always sent.
 * Kanban columns are fixed-width, so content pixels line up across screens;
 * the fluid list view sends x as a fraction of the width instead.
 */
export function useCursorBroadcast(el: HTMLElement | null, view: BoardView): void {
  useEffect(() => {
    if (!el) return;
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;

    const send = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      boardActions.sendCursor(view === 'list' ? x / Math.max(rect.width, 1) : x, y, view);
      last = performance.now();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      clearTimeout(trailing);
      const wait = SEND_EVERY_MS - (performance.now() - last);
      if (wait <= 0) send(event);
      else trailing = setTimeout(() => send(event), wait);
    };
    const onLeave = () => {
      clearTimeout(trailing);
      boardActions.leaveCursor();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      clearTimeout(trailing);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [el, view]);
}
