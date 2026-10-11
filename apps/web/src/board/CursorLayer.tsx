import type { BoardView } from '@flowsync/shared';
import { useRef } from 'react';
import { useBoard } from '../sync/board-store';

/** Other people's cursors, positioned in the same content coordinates. */
export function CursorLayer({ view }: { view: BoardView }) {
  const cursors = useBoard((s) => s.cursors);
  const layer = useRef<HTMLDivElement>(null);
  const width = layer.current?.offsetWidth ?? 0;

  return (
    <div
      ref={layer}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {Object.values(cursors)
        .filter((c) => c.view === view)
        .map((c) => {
          const x = view === 'list' ? c.x * width : c.x;
          return (
            <div
              key={c.socketId}
              className="absolute left-0 top-0 transition-transform duration-100 ease-linear will-change-transform"
              style={{ transform: `translate(${x}px, ${c.y}px)` }}
              data-testid="remote-cursor"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
                <path
                  d="M2 1.5 15.5 8 9 9.6 6.5 16 2 1.5Z"
                  fill={c.color}
                  stroke="white"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="ml-3 -mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow"
                style={{ backgroundColor: c.color }}
              >
                {c.name}
              </span>
            </div>
          );
        })}
    </div>
  );
}
