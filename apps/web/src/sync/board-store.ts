import {
  positionAtEnd,
  resolvePosition,
  type Ack,
  type ActivityDTO,
  type AuthorDTO,
  type BoardDTO,
  type ColumnDTO,
  type CursorState,
  type MemberDTO,
  type MessageDTO,
  type Page,
  type PlacementIntent,
  type PresenceUser,
  type Role,
  type ServerToClientEvents,
  type TaskDTO,
  type TaskPatch,
} from '@flowsync/shared';
import { create } from 'zustand';
import { ApiError, apiRequest } from '../lib/api';
import { uuid } from '../lib/ids';
import { getSocket, type AppSocket } from '../lib/socket';
import { toast } from '../lib/toast';
import {
  acknowledge,
  enqueue,
  initSync,
  orderBoard,
  pendingTaskIds,
  receive,
  reject,
  resetConfirmed,
  toBoardData,
  type Mutation,
  type OrderedBoard,
  type ServerChange,
  type SyncState,
} from './engine';
import { LatencyWindow, type LatencySummary } from './latency';

export interface BoardMeta {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  members: MemberDTO[];
}

export type ChatMessage = MessageDTO & { status?: 'sending' | 'failed' };
export type Panel = 'chat' | 'activity' | null;
export type TrackedCursor = CursorState & { at: number };

interface BoardState {
  boardId: string | null;
  me: AuthorDTO | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'deleted';
  error: string | null;
  meta: BoardMeta | null;
  sync: SyncState;
  ordered: OrderedBoard;
  pendingIds: Set<string>;
  presence: PresenceUser[];
  cursors: Record<string, TrackedCursor>;
  latency: LatencySummary & { ping: number | null };
  panel: Panel;
  chat: {
    messages: ChatMessage[];
    nextCursor: string | null;
    loaded: boolean;
    loading: boolean;
    unread: number;
    typing: Record<string, { name: string; until: number }>;
  };
  activity: { items: ActivityDTO[]; nextCursor: string | null; loaded: boolean; loading: boolean };
}

const initialState = (): BoardState => {
  const sync = initSync();
  return {
    boardId: null,
    me: null,
    status: 'idle',
    error: null,
    meta: null,
    sync,
    ordered: orderBoard(sync.view),
    pendingIds: new Set(),
    presence: [],
    cursors: {},
    latency: { last: null, p50: null, p95: null, count: 0, ping: null },
    panel: null,
    chat: { messages: [], nextCursor: null, loaded: false, loading: false, unread: 0, typing: {} },
    activity: { items: [], nextCursor: null, loaded: false, loading: false },
  };
};

export const useBoard = create<BoardState>(initialState);

const ACK_TIMEOUT_MS = 10_000;
const latencyWindow = new LatencyWindow();

function setSync(update: (sync: SyncState) => SyncState): void {
  useBoard.setState((state) => {
    const sync = update(state.sync);
    if (sync === state.sync) return state;
    return { sync, ordered: orderBoard(sync.view), pendingIds: pendingTaskIds(sync.pending) };
  });
}

// ------------------------------------------------------------------ snapshot & resync

/**
 * Changes received while a snapshot request is in flight. The snapshot might
 * have been read before or after each of them, so they are replayed on top of
 * it; version checks make the replay idempotent.
 */
let buffer: ServerChange[] | null = null;
let loadSeq = 0;

function applyRemote(change: ServerChange): void {
  if (buffer) buffer.push(change);
  else setSync((sync) => receive(sync, change));
}

async function resync(boardId: string): Promise<void> {
  const seq = ++loadSeq;
  buffer ??= [];
  try {
    const board = await apiRequest<BoardDTO>(`/api/boards/${boardId}`);
    if (seq !== loadSeq || useBoard.getState().boardId !== boardId) return;
    const queued = buffer ?? [];
    buffer = null;
    setSync((sync) =>
      queued.reduce(receive, resetConfirmed(sync, toBoardData(board.columns, board.tasks))),
    );
    useBoard.setState({
      status: 'ready',
      error: null,
      meta: {
        id: board.id,
        name: board.name,
        description: board.description,
        workspaceId: board.workspaceId,
        workspaceName: board.workspaceName,
        role: board.role,
        members: board.members,
      },
    });
  } catch (error) {
    if (seq !== loadSeq) return;
    buffer = null;
    if (useBoard.getState().status === 'ready') {
      toast('Could not refresh the board. Changes may be out of date.', 'error');
      return;
    }
    useBoard.setState({
      status: 'error',
      error:
        error instanceof ApiError && error.status === 404
          ? 'This board does not exist, or you do not have access to it.'
          : error instanceof Error
            ? error.message
            : 'Could not load the board.',
    });
  }
}

// ------------------------------------------------------------------ session

/**
 * Open a board: load the snapshot, join the realtime room, subscribe to
 * events. Returns the cleanup function. Every (re)join triggers a resync so
 * changes missed while disconnected are picked up.
 */
export function openBoard(boardId: string, me: AuthorDTO): () => void {
  const socket = getSocket();
  latencyWindow.reset();
  useBoard.setState({ ...initialState(), boardId, me, status: 'loading' });
  void resync(boardId);
  if (!socket) return () => useBoard.setState(initialState());

  const join = async () => {
    const response = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('board:join', { boardId })
      .catch(() => null);
    if (useBoard.getState().boardId !== boardId || !response) return;
    if (!response.ok) {
      useBoard.setState({ status: 'error', error: response.error.message });
      return;
    }
    useBoard.setState({ presence: response.data.presence });
    await resync(boardId);
  };

  const forBoard = (id: string) => id === boardId;
  const handlers = bindHandlers(socket, forBoard);
  socket.on('connect', join);
  if (socket.connected) void join();

  const pingTimer = setInterval(() => measurePing(socket), 10_000);
  measurePing(socket);
  const sweepTimer = setInterval(sweepStale, 2_000);

  return () => {
    clearInterval(pingTimer);
    clearInterval(sweepTimer);
    socket.off('connect', join);
    handlers();
    if (socket.connected) socket.emit('board:leave', { boardId });
    buffer = null;
    loadSeq++;
    useBoard.setState(initialState());
  };
}

function bindHandlers(socket: AppSocket, forBoard: (id: string) => boolean) {
  const onTask: ServerToClientEvents['task:upserted'] = ({ task }) => {
    if (forBoard(task.boardId)) applyRemote({ type: 'task.upsert', task });
  };
  const onTaskDeleted: ServerToClientEvents['task:deleted'] = (e) => {
    if (forBoard(e.boardId)) applyRemote({ type: 'task.delete', taskId: e.taskId });
  };
  const onColumn: ServerToClientEvents['column:upserted'] = ({ column }) => {
    if (forBoard(column.boardId)) applyRemote({ type: 'column.upsert', column });
  };
  const onColumnDeleted: ServerToClientEvents['column:deleted'] = (e) => {
    if (forBoard(e.boardId))
      applyRemote({ type: 'column.delete', columnId: e.columnId, taskIds: e.taskIds });
  };
  const onPresence: ServerToClientEvents['presence:update'] = (e) => {
    if (forBoard(e.boardId)) useBoard.setState({ presence: e.users });
  };
  const onCursors: ServerToClientEvents['cursor:batch'] = (e) => {
    if (!forBoard(e.boardId)) return;
    const now = Date.now();
    useBoard.setState((state) => {
      const cursors = { ...state.cursors };
      for (const cursor of e.cursors) {
        if (cursor.socketId !== socket.id) cursors[cursor.socketId] = { ...cursor, at: now };
      }
      return { cursors };
    });
  };
  const onCursorLeft: ServerToClientEvents['cursor:left'] = ({ socketId }) => {
    useBoard.setState((state) => {
      if (!state.cursors[socketId]) return state;
      const { [socketId]: _gone, ...cursors } = state.cursors;
      return { cursors };
    });
  };
  const onMessage: ServerToClientEvents['chat:message'] = ({ message }) => {
    if (!forBoard(message.boardId)) return;
    useBoard.setState((state) => {
      const { [message.author?.id ?? '']: _stopped, ...typing } = state.chat.typing;
      return {
        chat: {
          ...state.chat,
          typing,
          messages: mergeMessages(state.chat.messages, [message]),
          unread: state.panel === 'chat' ? 0 : state.chat.unread + 1,
        },
      };
    });
  };
  const onTyping: ServerToClientEvents['chat:typing'] = ({ userId, name, typing }) => {
    useBoard.setState((state) => {
      const next = { ...state.chat.typing };
      if (typing) next[userId] = { name, until: Date.now() + 5_000 };
      else delete next[userId];
      return { chat: { ...state.chat, typing: next } };
    });
  };
  const onActivity: ServerToClientEvents['activity:new'] = ({ activity }) => {
    if (!forBoard(activity.boardId)) return;
    useBoard.setState((state) =>
      state.activity.items.some((a) => a.id === activity.id)
        ? state
        : { activity: { ...state.activity, items: [activity, ...state.activity.items] } },
    );
  };
  const onBoardDeleted: ServerToClientEvents['board:deleted'] = (e) => {
    if (forBoard(e.boardId)) useBoard.setState({ status: 'deleted' });
  };

  socket.on('task:upserted', onTask);
  socket.on('task:deleted', onTaskDeleted);
  socket.on('column:upserted', onColumn);
  socket.on('column:deleted', onColumnDeleted);
  socket.on('presence:update', onPresence);
  socket.on('cursor:batch', onCursors);
  socket.on('cursor:left', onCursorLeft);
  socket.on('chat:message', onMessage);
  socket.on('chat:typing', onTyping);
  socket.on('activity:new', onActivity);
  socket.on('board:deleted', onBoardDeleted);

  return () => {
    socket.off('task:upserted', onTask);
    socket.off('task:deleted', onTaskDeleted);
    socket.off('column:upserted', onColumn);
    socket.off('column:deleted', onColumnDeleted);
    socket.off('presence:update', onPresence);
    socket.off('cursor:batch', onCursors);
    socket.off('cursor:left', onCursorLeft);
    socket.off('chat:message', onMessage);
    socket.off('chat:typing', onTyping);
    socket.off('activity:new', onActivity);
    socket.off('board:deleted', onBoardDeleted);
  };
}

/** Forget cursors and typing indicators that have gone quiet. */
function sweepStale(): void {
  const now = Date.now();
  useBoard.setState((state) => {
    const cursors = Object.fromEntries(
      Object.entries(state.cursors).filter(([, c]) => now - c.at < 10_000),
    );
    const typing = Object.fromEntries(
      Object.entries(state.chat.typing).filter(([, t]) => t.until > now),
    );
    const cursorsChanged = Object.keys(cursors).length !== Object.keys(state.cursors).length;
    const typingChanged = Object.keys(typing).length !== Object.keys(state.chat.typing).length;
    if (!cursorsChanged && !typingChanged) return state;
    return { cursors, chat: { ...state.chat, typing } };
  });
}

function measurePing(socket: AppSocket): void {
  if (!socket.connected) return;
  socket.timeout(5_000).emit('sync:ping', performance.now(), (error, sentAt) => {
    if (error) return;
    const ping = Math.round(performance.now() - sentAt);
    useBoard.setState((state) => ({ latency: { ...state.latency, ping } }));
  });
}

function recordLatency(ms: number): void {
  latencyWindow.record(Math.round(ms));
  useBoard.setState((state) => ({
    latency: { ...latencyWindow.summary(), ping: state.latency.ping },
  }));
}

// ------------------------------------------------------------------ mutations

type MutationEvent =
  | 'task:create'
  | 'task:update'
  | 'task:move'
  | 'task:delete'
  | 'column:create'
  | 'column:update'
  | 'column:move'
  | 'column:delete';

/**
 * Apply `mutation` optimistically, send it, and reconcile with the ack:
 * success → adopt the server's canonical row; failure → drop the pending
 * mutation (rollback) and tell the user.
 */
function dispatch<T>(
  mutation: Mutation,
  event: MutationEvent,
  payload: unknown,
  toChange: (data: T) => ServerChange,
): void {
  const { boardId } = useBoard.getState();
  const socket = getSocket();
  if (!boardId || !socket) return;
  setSync((sync) => enqueue(sync, mutation));

  const started = performance.now();
  const emitter = socket.timeout(ACK_TIMEOUT_MS) as unknown as {
    emit(
      event: MutationEvent,
      payload: unknown,
      ack: (error: Error | null, res: Ack<T>) => void,
    ): void;
  };
  emitter.emit(event, payload, (error, response) => {
    if (useBoard.getState().boardId !== boardId) return;
    if (error) {
      setSync((sync) => reject(sync, mutation.id));
      toast('The server did not confirm a change in time. Resyncing the board.', 'error');
      void resync(boardId);
      return;
    }
    recordLatency(performance.now() - started);
    if (response.ok) {
      setSync((sync) => acknowledge(sync, mutation.id, toChange(response.data)));
      return;
    }
    const missingTask = response.error.code === 'NOT_FOUND' && 'taskId' in mutation;
    setSync((sync) =>
      reject(
        sync,
        mutation.id,
        missingTask ? { type: 'task.delete', taskId: mutation.taskId } : undefined,
      ),
    );
    toast(response.error.message, 'error');
    if (response.error.code === 'NOT_FOUND') void resync(boardId);
  });
}

const upsertTask = (task: TaskDTO): ServerChange => ({ type: 'task.upsert', task });
const upsertColumn = (column: ColumnDTO): ServerChange => ({ type: 'column.upsert', column });

export const boardActions = {
  createTask(columnId: string, title: string): void {
    const { boardId, ordered } = useBoard.getState();
    if (!boardId) return;
    const now = new Date().toISOString();
    const task: TaskDTO = {
      id: uuid(),
      boardId,
      columnId,
      title,
      description: '',
      position: positionAtEnd(ordered.tasksByColumn[columnId] ?? []),
      priority: 'MEDIUM',
      assigneeId: null,
      dueDate: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const mutationId = uuid();
    dispatch<TaskDTO>(
      { kind: 'task.create', id: mutationId, task },
      'task:create',
      { boardId, mutationId, task: { id: task.id, columnId, title } },
      upsertTask,
    );
  },

  updateTask(taskId: string, patch: TaskPatch): void {
    const { boardId } = useBoard.getState();
    if (!boardId) return;
    const mutationId = uuid();
    dispatch<TaskDTO>(
      { kind: 'task.update', id: mutationId, taskId, patch },
      'task:update',
      { boardId, mutationId, taskId, patch },
      upsertTask,
    );
  },

  /**
   * Move by intent. The optimistic position uses the same resolvePosition()
   * the server runs, so without concurrent edits the ack changes nothing.
   */
  moveTask(taskId: string, toColumnId: string, intent: PlacementIntent): void {
    const { boardId, ordered } = useBoard.getState();
    if (!boardId) return;
    const siblings = (ordered.tasksByColumn[toColumnId] ?? []).filter((t) => t.id !== taskId);
    const position = resolvePosition(siblings, intent);
    const mutationId = uuid();
    dispatch<TaskDTO>(
      { kind: 'task.move', id: mutationId, taskId, columnId: toColumnId, position },
      'task:move',
      { boardId, mutationId, taskId, toColumnId, ...intent },
      upsertTask,
    );
  },

  deleteTask(taskId: string): void {
    const { boardId } = useBoard.getState();
    if (!boardId) return;
    const mutationId = uuid();
    dispatch<{ taskId: string }>(
      { kind: 'task.delete', id: mutationId, taskId },
      'task:delete',
      { boardId, mutationId, taskId },
      () => ({ type: 'task.delete', taskId }),
    );
  },

  createColumn(name: string): void {
    const { boardId, ordered } = useBoard.getState();
    if (!boardId) return;
    const column: ColumnDTO = {
      id: uuid(),
      boardId,
      name,
      position: positionAtEnd(ordered.columns),
    };
    const mutationId = uuid();
    dispatch<ColumnDTO>(
      { kind: 'column.create', id: mutationId, column },
      'column:create',
      { boardId, mutationId, column: { id: column.id, name } },
      upsertColumn,
    );
  },

  renameColumn(columnId: string, name: string): void {
    const { boardId } = useBoard.getState();
    if (!boardId) return;
    const mutationId = uuid();
    dispatch<ColumnDTO>(
      { kind: 'column.rename', id: mutationId, columnId, name },
      'column:update',
      { boardId, mutationId, columnId, name },
      upsertColumn,
    );
  },

  moveColumn(columnId: string, intent: PlacementIntent): void {
    const { boardId, ordered } = useBoard.getState();
    if (!boardId) return;
    const siblings = ordered.columns.filter((c) => c.id !== columnId);
    const position = resolvePosition(siblings, intent);
    const mutationId = uuid();
    dispatch<ColumnDTO>(
      { kind: 'column.move', id: mutationId, columnId, position },
      'column:move',
      { boardId, mutationId, columnId, ...intent },
      upsertColumn,
    );
  },

  deleteColumn(columnId: string): void {
    const { boardId, ordered } = useBoard.getState();
    if (!boardId) return;
    const taskIds = (ordered.tasksByColumn[columnId] ?? []).map((t) => t.id);
    const mutationId = uuid();
    dispatch<{ columnId: string }>(
      { kind: 'column.delete', id: mutationId, columnId },
      'column:delete',
      { boardId, mutationId, columnId },
      () => ({ type: 'column.delete', columnId, taskIds }),
    );
  },

  // -------------------------------------------------------------- panels, chat, activity

  setPanel(panel: Panel): void {
    useBoard.setState((state) => ({
      panel,
      chat: panel === 'chat' ? { ...state.chat, unread: 0 } : state.chat,
    }));
    if (panel === 'chat') void boardActions.loadMessages();
    if (panel === 'activity') void boardActions.loadActivity();
  },

  async loadMessages(older = false): Promise<void> {
    const { boardId, chat } = useBoard.getState();
    if (!boardId || chat.loading || (!older && chat.loaded) || (older && !chat.nextCursor)) return;
    useBoard.setState((s) => ({ chat: { ...s.chat, loading: true } }));
    try {
      const cursor = older && chat.nextCursor ? `&before=${chat.nextCursor}` : '';
      const page = await apiRequest<Page<MessageDTO>>(
        `/api/boards/${boardId}/messages?limit=50${cursor}`,
      );
      if (useBoard.getState().boardId !== boardId) return;
      useBoard.setState((s) => ({
        chat: {
          ...s.chat,
          loading: false,
          loaded: true,
          nextCursor: page.nextCursor,
          messages: mergeMessages(s.chat.messages, page.items),
        },
      }));
    } catch {
      useBoard.setState((s) => ({ chat: { ...s.chat, loading: false } }));
      toast('Could not load chat history.', 'error');
    }
  },

  sendMessage(body: string, retryOf?: ChatMessage): void {
    const { boardId, me } = useBoard.getState();
    const socket = getSocket();
    if (!boardId || !me || !socket) return;
    const clientId = retryOf?.clientId ?? uuid();
    const optimistic: ChatMessage = {
      id: `local-${clientId}`,
      boardId,
      body,
      createdAt: retryOf?.createdAt ?? new Date().toISOString(),
      author: me,
      clientId,
      status: 'sending',
    };
    useBoard.setState((s) => ({
      chat: {
        ...s.chat,
        messages: [...s.chat.messages.filter((m) => m.clientId !== clientId), optimistic],
      },
    }));
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit('chat:send', { boardId, clientId, body }, (error, response) => {
        useBoard.setState((s) => ({
          chat: {
            ...s.chat,
            messages: s.chat.messages.map((m): ChatMessage => {
              if (m.clientId !== clientId || m.status !== 'sending') return m;
              if (!error && response.ok) return { ...response.data };
              return { ...m, status: 'failed' };
            }),
          },
        }));
        if (!error && !response.ok) toast(response.error.message, 'error');
      });
  },

  typing(typing: boolean): void {
    const { boardId } = useBoard.getState();
    if (boardId) getSocket()?.emit('chat:typing', { boardId, typing });
  },

  async loadActivity(more = false): Promise<void> {
    const { boardId, activity } = useBoard.getState();
    if (
      !boardId ||
      activity.loading ||
      (!more && activity.loaded) ||
      (more && !activity.nextCursor)
    ) {
      return;
    }
    useBoard.setState((s) => ({ activity: { ...s.activity, loading: true } }));
    try {
      const cursor = more && activity.nextCursor ? `&before=${activity.nextCursor}` : '';
      const page = await apiRequest<Page<ActivityDTO>>(
        `/api/boards/${boardId}/activity?limit=30${cursor}`,
      );
      if (useBoard.getState().boardId !== boardId) return;
      useBoard.setState((s) => {
        const seen = new Set(s.activity.items.map((a) => a.id));
        return {
          activity: {
            loading: false,
            loaded: true,
            nextCursor: page.nextCursor,
            items: [...s.activity.items, ...page.items.filter((a) => !seen.has(a.id))],
          },
        };
      });
    } catch {
      useBoard.setState((s) => ({ activity: { ...s.activity, loading: false } }));
      toast('Could not load the activity log.', 'error');
    }
  },

  sendCursor(x: number, y: number, view: 'kanban' | 'list'): void {
    const { boardId } = useBoard.getState();
    const socket = getSocket();
    if (boardId && socket?.connected) socket.volatile.emit('cursor:move', { boardId, x, y, view });
  },

  leaveCursor(): void {
    const { boardId } = useBoard.getState();
    if (boardId) getSocket()?.emit('cursor:leave', { boardId });
  },

  retry(): void {
    const { boardId } = useBoard.getState();
    if (!boardId) return;
    useBoard.setState({ status: 'loading', error: null });
    void resync(boardId);
  },
};

/** Merge chat messages by id, oldest first. */
function mergeMessages(current: ChatMessage[], incoming: MessageDTO[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
