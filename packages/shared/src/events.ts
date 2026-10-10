import type {
  ChatSendInput,
  ChatTypingInput,
  ColumnCreateInput,
  ColumnDeleteInput,
  ColumnMoveInput,
  ColumnUpdateInput,
  CursorMoveInput,
  TaskCreateInput,
  TaskDeleteInput,
  TaskMoveInput,
  TaskUpdateInput,
} from './schemas.js';
import type {
  ActivityDTO,
  ColumnDTO,
  CursorState,
  ErrorCode,
  MessageDTO,
  PresenceUser,
  TaskDTO,
} from './types.js';

/**
 * Typed Socket.io contract. Both `socket.io` (server) and `socket.io-client`
 * accept these maps as generics, so an event name or payload typo is a
 * compile error on either side.
 */

export type Ack<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };
export type AckCallback<T> = (response: Ack<T>) => void;

export interface JoinResult {
  presence: PresenceUser[];
}

/** Every broadcast caused by a mutation carries who did it and which mutation it was. */
export interface MutationMeta {
  mutationId: string;
  actorId: string;
}

export interface ClientToServerEvents {
  'board:join': (payload: { boardId: string }, ack: AckCallback<JoinResult>) => void;
  'board:leave': (payload: { boardId: string }) => void;

  'task:create': (payload: TaskCreateInput, ack: AckCallback<TaskDTO>) => void;
  'task:update': (payload: TaskUpdateInput, ack: AckCallback<TaskDTO>) => void;
  'task:move': (payload: TaskMoveInput, ack: AckCallback<TaskDTO>) => void;
  'task:delete': (payload: TaskDeleteInput, ack: AckCallback<{ taskId: string }>) => void;

  'column:create': (payload: ColumnCreateInput, ack: AckCallback<ColumnDTO>) => void;
  'column:update': (payload: ColumnUpdateInput, ack: AckCallback<ColumnDTO>) => void;
  'column:move': (payload: ColumnMoveInput, ack: AckCallback<ColumnDTO>) => void;
  'column:delete': (payload: ColumnDeleteInput, ack: AckCallback<{ columnId: string }>) => void;

  'chat:send': (payload: ChatSendInput, ack: AckCallback<MessageDTO>) => void;
  'chat:typing': (payload: ChatTypingInput) => void;

  'cursor:move': (payload: CursorMoveInput) => void;
  'cursor:leave': (payload: { boardId: string }) => void;

  /** Round-trip probe used by the latency indicator and the benchmark. */
  'sync:ping': (sentAt: number, ack: (sentAt: number) => void) => void;
}

export interface ServerToClientEvents {
  'task:upserted': (payload: MutationMeta & { task: TaskDTO }) => void;
  'task:deleted': (payload: MutationMeta & { taskId: string; boardId: string }) => void;
  'column:upserted': (payload: MutationMeta & { column: ColumnDTO }) => void;
  /** Deleting a column deletes its tasks; `taskIds` lets clients drop them. */
  'column:deleted': (
    payload: MutationMeta & { columnId: string; boardId: string; taskIds: string[] },
  ) => void;

  'chat:message': (payload: { message: MessageDTO }) => void;
  'chat:typing': (payload: { userId: string; name: string; typing: boolean }) => void;

  'presence:update': (payload: { boardId: string; users: PresenceUser[] }) => void;
  'cursor:batch': (payload: { boardId: string; cursors: CursorState[] }) => void;
  'cursor:left': (payload: { socketId: string }) => void;

  'activity:new': (payload: { activity: ActivityDTO }) => void;
  'board:deleted': (payload: { boardId: string }) => void;
}

export interface SocketData {
  user: { id: string; name: string; avatarColor: string };
  boardId?: string;
}
