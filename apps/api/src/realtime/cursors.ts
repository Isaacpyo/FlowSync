import type { CursorState } from '@flowsync/shared';
import { boardRoom, type IO } from './types.js';

/**
 * Coalesces cursor movement. Clients send at most ~20 updates/s each; instead
 * of re-broadcasting every one, the hub keeps the latest position per socket
 * and flushes one `cursor:batch` per board per tick. Broadcast volume (and
 * Redis PUBLISH count) is bounded by boards × ticks, not users × moves, and
 * drops to zero when nobody moves. Emits are volatile: a dropped frame is
 * replaced by the next one.
 */
export class CursorHub {
  private readonly dirty = new Map<string, Map<string, CursorState>>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly io: IO,
    tickMs = 50,
  ) {
    this.timer = setInterval(() => this.flush(), tickMs);
    this.timer.unref();
  }

  update(boardId: string, cursor: CursorState): void {
    let board = this.dirty.get(boardId);
    if (!board) {
      board = new Map();
      this.dirty.set(boardId, board);
    }
    board.set(cursor.socketId, cursor);
  }

  remove(boardId: string, socketId: string): void {
    this.dirty.get(boardId)?.delete(socketId);
    this.io.to(boardRoom(boardId)).emit('cursor:left', { socketId });
  }

  flush(): void {
    for (const [boardId, cursors] of this.dirty) {
      if (cursors.size > 0) {
        this.io
          .to(boardRoom(boardId))
          .volatile.emit('cursor:batch', { boardId, cursors: [...cursors.values()] });
      }
    }
    this.dirty.clear();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
