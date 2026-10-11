import type { ColumnDTO, TaskDTO } from '@flowsync/shared';
import { describe, expect, it } from 'vitest';
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
  type SyncState,
} from './engine';

const col = (id: string, position: string, name = id): ColumnDTO => ({
  id,
  boardId: 'b',
  name,
  position,
});

const task = (
  id: string,
  columnId: string,
  position: string,
  extra: Partial<TaskDTO> = {},
): TaskDTO => ({
  id,
  boardId: 'b',
  columnId,
  title: id,
  description: '',
  position,
  priority: 'MEDIUM',
  assigneeId: null,
  dueDate: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

function board(): SyncState {
  return initSync(
    toBoardData(
      [col('todo', 'a0', 'To do'), col('done', 'a1', 'Done')],
      [task('A', 'todo', 'a0'), task('B', 'todo', 'a1'), task('C', 'done', 'a0')],
    ),
  );
}

const titles = (state: SyncState, columnId: string) =>
  orderBoard(state.view).tasksByColumn[columnId]?.map((t) => t.id);

describe('optimistic updates', () => {
  it('shows a pending move immediately and keeps it after the ack', () => {
    let state = enqueue(board(), {
      kind: 'task.move',
      id: 'm1',
      taskId: 'A',
      columnId: 'done',
      position: 'a1',
    });
    expect(titles(state, 'todo')).toEqual(['B']);
    expect(titles(state, 'done')).toEqual(['C', 'A']);
    expect(state.confirmed.tasks.A?.columnId).toBe('todo');
    expect(pendingTaskIds(state.pending)).toEqual(new Set(['A']));

    state = acknowledge(state, 'm1', {
      type: 'task.upsert',
      task: task('A', 'done', 'a1', { version: 2 }),
    });
    expect(state.pending).toHaveLength(0);
    expect(titles(state, 'done')).toEqual(['C', 'A']);
    expect(state.confirmed.tasks.A?.version).toBe(2);
  });

  it('adopts the server position when it differs from the optimistic guess', () => {
    let state = enqueue(board(), {
      kind: 'task.move',
      id: 'm1',
      taskId: 'A',
      columnId: 'done',
      position: 'a1',
    });
    // Someone else got the slot first; the server placed A before C instead.
    state = acknowledge(state, 'm1', {
      type: 'task.upsert',
      task: task('A', 'done', 'Zz', { version: 2 }),
    });
    expect(titles(state, 'done')).toEqual(['A', 'C']);
  });

  it('rolls back a rejected mutation', () => {
    let state = enqueue(board(), {
      kind: 'task.update',
      id: 'm1',
      taskId: 'B',
      patch: { title: 'Renamed' },
    });
    expect(state.view.tasks.B?.title).toBe('Renamed');
    state = reject(state, 'm1');
    expect(state.view.tasks.B?.title).toBe('B');
  });

  it('removes a task whose mutation failed because it no longer exists', () => {
    let state = enqueue(board(), {
      kind: 'task.update',
      id: 'm1',
      taskId: 'B',
      patch: { priority: 'HIGH' },
    });
    state = reject(state, 'm1', { type: 'task.delete', taskId: 'B' });
    expect(state.view.tasks.B).toBeUndefined();
  });

  it('creates tasks optimistically with their final id', () => {
    const created = task('N', 'todo', 'a2');
    let state = enqueue(board(), { kind: 'task.create', id: 'm1', task: created });
    expect(titles(state, 'todo')).toEqual(['A', 'B', 'N']);
    state = acknowledge(state, 'm1', { type: 'task.upsert', task: created });
    expect(titles(state, 'todo')).toEqual(['A', 'B', 'N']);
  });
});

describe('server reconciliation', () => {
  it('rebases pending local edits on top of remote changes', () => {
    // Local: rename A (pending). Remote: someone moves A to Done.
    let state = enqueue(board(), {
      kind: 'task.update',
      id: 'm1',
      taskId: 'A',
      patch: { title: 'Mine' },
    });
    state = receive(state, { type: 'task.upsert', task: task('A', 'done', 'a1', { version: 2 }) });
    expect(state.view.tasks.A).toMatchObject({ title: 'Mine', columnId: 'done' });

    // The ack for the rename carries version 3 (it was applied after the move).
    state = acknowledge(state, 'm1', {
      type: 'task.upsert',
      task: task('A', 'done', 'a1', { version: 3, title: 'Mine' }),
    });
    expect(state.view.tasks.A).toMatchObject({ title: 'Mine', columnId: 'done', version: 3 });
  });

  it('ignores stale, out-of-order events', () => {
    let state = receive(board(), {
      type: 'task.upsert',
      task: task('A', 'done', 'a1', { version: 3 }),
    });
    state = receive(state, { type: 'task.upsert', task: task('A', 'todo', 'a0', { version: 2 }) });
    expect(state.view.tasks.A).toMatchObject({ columnId: 'done', version: 3 });
  });

  it('never resurrects a deleted task', () => {
    let state = receive(board(), { type: 'task.delete', taskId: 'A' });
    state = receive(state, { type: 'task.upsert', task: task('A', 'todo', 'a0', { version: 9 }) });
    expect(state.view.tasks.A).toBeUndefined();
  });

  it('drops a pending edit to a task deleted remotely without crashing', () => {
    let state = enqueue(board(), {
      kind: 'task.move',
      id: 'm1',
      taskId: 'A',
      columnId: 'done',
      position: 'a1',
    });
    state = receive(state, { type: 'task.delete', taskId: 'A' });
    expect(state.view.tasks.A).toBeUndefined();
    state = reject(state, 'm1');
    expect(state.pending).toHaveLength(0);
  });

  it('removes a deleted column and all of its tasks', () => {
    const state = receive(board(), {
      type: 'column.delete',
      columnId: 'todo',
      taskIds: ['A', 'B'],
    });
    expect(orderBoard(state.view).columns.map((c) => c.id)).toEqual(['done']);
    expect(Object.keys(state.view.tasks)).toEqual(['C']);
  });

  it('keeps pending mutations across a snapshot resync', () => {
    let state = enqueue(board(), {
      kind: 'task.update',
      id: 'm1',
      taskId: 'C',
      patch: { title: 'Pending' },
    });
    state = resetConfirmed(
      state,
      toBoardData([col('done', 'a1')], [task('C', 'done', 'a0', { version: 5 })]),
    );
    expect(state.view.tasks.C).toMatchObject({ title: 'Pending', version: 5 });
    expect(state.view.tasks.A).toBeUndefined();
  });
});

describe('orderBoard', () => {
  it('sorts columns and tasks byte-wise by position', () => {
    const state = initSync(
      toBoardData(
        [col('second', 'a0'), col('first', 'Zz')],
        [task('y', 'first', 'a0'), task('x', 'first', 'Zz'), task('orphan', 'gone', 'a0')],
      ),
    );
    const ordered = orderBoard(state.view);
    expect(ordered.columns.map((c) => c.id)).toEqual(['first', 'second']);
    expect(ordered.tasksByColumn.first?.map((t) => t.id)).toEqual(['x', 'y']);
    expect(ordered.tasksByColumn.second).toEqual([]);
  });
});
