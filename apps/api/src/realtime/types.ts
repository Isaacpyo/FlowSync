import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '@flowsync/shared';
import type { Server, Socket } from 'socket.io';

export type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type ClientSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export const boardRoom = (boardId: string) => `board:${boardId}`;
