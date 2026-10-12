import { sortByPosition, type ColumnDTO, type TaskDTO, type TaskPatch } from '@flowsync/shared';

/**
 * Optimistic updates with server reconciliation.
 *
 * The client keeps two things:
 *
 * - `confirmed`: the last state the server told us about (snapshot plus
 *   acknowledged and broadcast changes);
 * - `pending`: the local mutations the server has not answered yet, in the
 *   order they were issued.
 *
 * What the user sees is `view = pending.reduce(applyMutation, confirmed)`.
 * When a remote change arrives it is applied to `confirmed` and the pending
 * mutations are replayed on top ("rebased"), so local edits in flight are
 * never clobbered. An ack replaces the optimistic guess with the server's
 * canonical row; a rejection simply drops the pending mutation, which rolls
 * it back automatically.
 *
 * Everything here is pure and synchronous, so it is unit-tested without a
 * server or a DOM.
 */

export interface BoardData {
  columns: Readonly<Record<string, ColumnDTO>>;
  tasks: Readonly<Record<string, TaskDTO>>;
}

export type Mutation =
  | { kind: 'task.create'; id: string; task: TaskDTO }
  | { kind: 'task.update'; id: string; taskId: string; patch: TaskPatch }
  | { kind: 'task.move'; id: string; taskId: string; columnId: string; position: string }
  | { kind: 'task.delete'; id: string; taskId: string }
  | { kind: 'column.create'; id: string; column: ColumnDTO }
  | { kind: 'column.rename'; id: string; columnId: string; name: string }
  | { kind: 'column.move'; id: string; columnId: string; position: string }
  | { kind: 'column.delete'; id: string; columnId: string };

/** Authoritative changes coming from the server (acks and broadcasts). */
export type ServerChange =
  | { type: 'task.upsert'; task: TaskDTO }
  | { type: 'task.delete'; taskId: string }
  | { type: 'column.upsert'; column: ColumnDTO }
  | { type: 'column.delete'; columnId: string; taskIds: readonly string[] };

export interface SyncState {
  confirmed: BoardData;
  pending: readonly Mutation[];
  /** Ids the server deleted. A late, out-of-order upsert must not resurrect them. */
  tombstones: ReadonlySet<string>;
  view: BoardData;
}

export const EMPTY_BOARD: BoardData = { columns: {}, tasks: {} };

export function toBoardData(columns: readonly ColumnDTO[], tasks: readonly TaskDTO[]): BoardData {
  return {
    columns: Object.fromEntries(columns.map((c) => [c.id, c])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  };
}

function without<T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const { [id]: _removed, ...rest } = record;
  return rest;
}

export function applyMutation(data: BoardData, m: Mutation): BoardData {
  switch (m.kind) {
    case 'task.create':
      return { ...data, tasks: { ...data.tasks, [m.task.id]: m.task } };
    case 'task.update': {
      const task = data.tasks[m.taskId];
      if (!task) return data;
      return { ...data, tasks: { ...data.tasks, [task.id]: { ...task, ...m.patch } } };
    }
    case 'task.move': {
      const task = data.tasks[m.taskId];
      if (!task || !data.columns[m.columnId]) return data;
      return {
        ...data,
        tasks: {
          ...data.tasks,
          [task.id]: { ...task, columnId: m.columnId, position: m.position },
        },
      };
    }
    case 'task.delete':
      return data.tasks[m.taskId] ? { ...data, tasks: without(data.tasks, m.taskId) } : data;
    case 'column.create':
      return { ...data, columns: { ...data.columns, [m.column.id]: m.column } };
    case 'column.rename': {
      const column = data.columns[m.columnId];
      if (!column) return data;
      return { ...data, columns: { ...data.columns, [column.id]: { ...column, name: m.name } } };
    }
    case 'column.move': {
      const column = data.columns[m.columnId];
      if (!column) return data;
      return {
        ...data,
        columns: { ...data.columns, [column.id]: { ...column, position: m.position } },
      };
    }
    case 'column.delete': {
      if (!data.columns[m.columnId]) return data;
      const tasks = Object.fromEntries(
        Object.entries(data.tasks).filter(([, task]) => task.columnId !== m.columnId),
      );
      return { columns: without(data.columns, m.columnId), tasks };
    }
  }
}

function applyServerChange(
  confirmed: BoardData,
  tombstones: ReadonlySet<string>,
  change: ServerChange,
): { confirmed: BoardData; tombstones: ReadonlySet<string> } {
  switch (change.type) {
    case 'task.upsert': {
      const { task } = change;
      if (tombstones.has(task.id)) return { confirmed, tombstones };
      const current = confirmed.tasks[task.id];
      // Events can arrive out of order (acks vs broadcasts, several instances).
      if (current && current.version >= task.version) return { confirmed, tombstones };
      return {
        confirmed: { ...confirmed, tasks: { ...confirmed.tasks, [task.id]: task } },
        tombstones,
      };
    }
    case 'task.delete':
      return {
        confirmed: { ...confirmed, tasks: without(confirmed.tasks, change.taskId) },
        tombstones: new Set([...tombstones, change.taskId]),
      };
    case 'column.upsert': {
      if (tombstones.has(change.column.id)) return { confirmed, tombstones };
      return {
        confirmed: {
          ...confirmed,
          columns: { ...confirmed.columns, [change.column.id]: change.column },
        },
        tombstones,
      };
    }
    case 'column.delete': {
      const removed = new Set(change.taskIds);
      const tasks = Object.fromEntries(
        Object.entries(confirmed.tasks).filter(
          ([id, task]) => !removed.has(id) && task.columnId !== change.columnId,
        ),
      );
      return {
        confirmed: { columns: without(confirmed.columns, change.columnId), tasks },
        tombstones: new Set([...tombstones, change.columnId, ...change.taskIds]),
      };
    }
  }
}

function withView(state: Omit<SyncState, 'view'>): SyncState {
  return { ...state, view: state.pending.reduce(applyMutation, state.confirmed) };
}

export function initSync(data: BoardData = EMPTY_BOARD): SyncState {
  return withView({ confirmed: data, pending: [], tombstones: new Set() });
}

/** Apply a local mutation optimistically. */
export function enqueue(state: SyncState, mutation: Mutation): SyncState {
  return withView({ ...state, pending: [...state.pending, mutation] });
}

/** The server accepted `mutationId`; `change` is its canonical result. */
export function acknowledge(
  state: SyncState,
  mutationId: string,
  change?: ServerChange,
): SyncState {
  const pending = state.pending.filter((m) => m.id !== mutationId);
  const next = change ? applyServerChange(state.confirmed, state.tombstones, change) : state;
  return withView({ confirmed: next.confirmed, tombstones: next.tombstones, pending });
}

/**
 * The server rejected `mutationId`. Dropping it from the queue is the
 * rollback; `correction` lets the caller fix confirmed state at the same time
 * (e.g. the task turned out to be deleted).
 */
export function reject(state: SyncState, mutationId: string, correction?: ServerChange): SyncState {
  return acknowledge(state, mutationId, correction);
}

/** A change made by someone else. */
export function receive(state: SyncState, change: ServerChange): SyncState {
  const next = applyServerChange(state.confirmed, state.tombstones, change);
  if (next.confirmed === state.confirmed) return state;
  return withView({ ...state, confirmed: next.confirmed, tombstones: next.tombstones });
}

/** Replace confirmed state with a fresh snapshot (initial load, resync after reconnect). */
export function resetConfirmed(state: SyncState, data: BoardData): SyncState {
  return withView({ confirmed: data, tombstones: new Set(), pending: state.pending });
}

export interface OrderedBoard {
  columns: ColumnDTO[];
  tasksByColumn: Record<string, TaskDTO[]>;
}

/** Columns and per-column task lists, sorted by fractional position. */
export function orderBoard(view: BoardData): OrderedBoard {
  const columns = sortByPosition(Object.values(view.columns));
  const tasksByColumn: Record<string, TaskDTO[]> = Object.fromEntries(
    columns.map((c) => [c.id, [] as TaskDTO[]]),
  );
  for (const task of Object.values(view.tasks)) tasksByColumn[task.columnId]?.push(task);
  for (const id of Object.keys(tasksByColumn)) {
    tasksByColumn[id] = sortByPosition(tasksByColumn[id] ?? []);
  }
  return { columns, tasksByColumn };
}

/** Ids of tasks with a local change still waiting for the server. */
export function pendingTaskIds(pending: readonly Mutation[]): Set<string> {
  const ids = new Set<string>();
  for (const m of pending) {
    if (m.kind === 'task.create') ids.add(m.task.id);
    else if ('taskId' in m) ids.add(m.taskId);
  }
  return ids;
}
