import type { PresenceUser } from '@flowsync/shared';
import type { Logger } from '../logger.js';
import { boardRoom, type IO } from './types.js';

/**
 * Presence is derived from the sockets in the board room rather than stored
 * separately. With the Redis adapter, fetchSockets() asks every API instance,
 * so the list is cluster-wide and can never drift from who is connected.
 */
export async function presenceFor(
  io: IO,
  boardId: string,
  logger: Logger,
): Promise<PresenceUser[]> {
  let sockets;
  try {
    sockets = await io.in(boardRoom(boardId)).fetchSockets();
  } catch (error) {
    // Another instance did not answer in time: fall back to what we know locally.
    logger.warn({ err: error, boardId }, 'cluster presence lookup failed');
    sockets = await io.local.in(boardRoom(boardId)).fetchSockets();
  }
  const users = new Map<string, PresenceUser>();
  for (const socket of sockets) {
    const user = socket.data.user;
    if (!user) continue;
    const entry = users.get(user.id);
    if (entry) entry.connections += 1;
    else
      users.set(user.id, {
        userId: user.id,
        name: user.name,
        avatarColor: user.avatarColor,
        connections: 1,
      });
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function broadcastPresence(io: IO, boardId: string, logger: Logger): Promise<void> {
  const users = await presenceFor(io, boardId, logger);
  io.to(boardRoom(boardId)).emit('presence:update', { boardId, users });
}
