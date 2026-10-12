import { randomUUID } from 'node:crypto';
import { compareKeys, sortByPosition } from '@flowsync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/db.js';
import { AppError } from '../src/errors.js';
import { createColumn, deleteColumn, moveColumn } from '../src/services/columns.js';
import { createTask, deleteTask, moveTask, updateTask } from '../src/services/tasks.js';
import { createBoard, createWorkspace } from '../src/services/workspaces.js';
import { TEST_DATABASE_URL } from './env.js';
import { resetDatabase } from './helpers.js';

const prisma = createPrisma(TEST_DATABASE_URL);
let userId: string;
let boardId: string;
let columns: { id: string; name: string }[];

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase(prisma);
  const user = await prisma.user.create({
    data: { name: 'Ada', email: 'ada@test.dev', avatarColor: '#6366f1' },
  });
  userId = user.id;
  const workspace = await createWorkspace(prisma, userId, 'Studio');
  const board = await createBoard(prisma, userId, workspace.id, { name: 'Board', description: '' });
  boardId = board.id;
  columns = await prisma.column.findMany({ where: { boardId }, orderBy: { position: 'asc' } });
});

const todo = () => columns[0]!.id;
const doing = () => columns[1]!.id;

async function addTask(title: string, columnId = todo()) {
  const { task } = await createTask(prisma, userId, {
    boardId,
    mutationId: randomUUID(),
    task: {
      id: randomUUID(),
      columnId,
      title,
      description: '',
      priority: 'MEDIUM',
      assigneeId: null,
      dueDate: null,
    },
  });
  return task;
}

async function titlesIn(columnId: string): Promise<string[]> {
  const tasks = await prisma.task.findMany({ where: { columnId } });
  return sortByPosition(tasks).map((t) => t.title);
}

function move(taskId: string, toColumnId: string, afterId: string | null, beforeId: string | null) {
  return moveTask(prisma, userId, {
    boardId,
    mutationId: randomUUID(),
    taskId,
    toColumnId,
    afterId,
    beforeId,
  });
}

describe('task ordering', () => {
  it('appends new tasks to the end of a column', async () => {
    await addTask('A');
    await addTask('B');
    await addTask('C');
    expect(await titlesIn(todo())).toEqual(['A', 'B', 'C']);
  });

  it('moves within and across columns, logging only cross-column moves', async () => {
    const a = await addTask('A');
    const b = await addTask('B');
    const c = await addTask('C');

    const reorder = await move(c.id, todo(), null, a.id);
    expect(reorder.activity).toBeNull();
    expect(reorder.task.version).toBe(2);
    expect(await titlesIn(todo())).toEqual(['C', 'A', 'B']);

    const across = await move(a.id, doing(), null, null);
    expect(across.task.columnId).toBe(doing());
    expect(across.activity).toMatchObject({
      type: 'task.moved',
      data: { taskTitle: 'A', fromColumn: 'To do', toColumn: 'In progress' },
    });
    expect(await titlesIn(todo())).toEqual(['C', 'B']);
    expect(await titlesIn(doing())).toEqual(['A']);
    expect(b.version).toBe(1);
  });

  it('serialises concurrent drops into the same gap: no lost writes, no duplicate keys', async () => {
    const first = await addTask('first');
    const last = await addTask('last');
    const movers = await Promise.all(
      Array.from({ length: 12 }, (_, i) => addTask(`mover-${i}`, doing())),
    );

    // Twelve clients all saw [first, last] and dropped "their" task between them at once.
    const results = await Promise.all(movers.map((m) => move(m.id, todo(), first.id, last.id)));

    const tasks = sortByPosition(await prisma.task.findMany({ where: { columnId: todo() } }));
    expect(tasks).toHaveLength(14);
    expect(tasks[0]!.title).toBe('first');
    expect(tasks[tasks.length - 1]!.title).toBe('last');
    expect(new Set(tasks.map((t) => t.position)).size).toBe(14);
    for (const result of results) {
      expect(compareKeys(first.position, result.task.position)).toBe(-1);
      expect(compareKeys(result.task.position, last.position)).toBe(-1);
    }
  });

  it('re-resolves stale anchors against the live order', async () => {
    const a = await addTask('A');
    const b = await addTask('B');
    const x = await addTask('X', doing());

    // The client still thinks A is in "To do", but someone moved it away.
    await move(a.id, doing(), null, null);
    await move(x.id, todo(), a.id, b.id);
    expect(await titlesIn(todo())).toEqual(['X', 'B']);
  });

  it('rejects tasks and columns from another board', async () => {
    const otherWs = await createWorkspace(prisma, userId, 'Other');
    const other = await createBoard(prisma, userId, otherWs.id, { name: 'Other', description: '' });
    const otherColumn = await prisma.column.findFirstOrThrow({ where: { boardId: other.id } });
    const task = await addTask('Mine');

    await expect(move(task.id, otherColumn.id, null, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      moveTask(prisma, userId, {
        boardId: other.id,
        mutationId: 'm',
        taskId: task.id,
        toColumnId: otherColumn.id,
        afterId: null,
        beforeId: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('task updates', () => {
  it('writes only changed fields, bumps the version and logs which fields changed', async () => {
    const task = await addTask('Draft');
    const result = await updateTask(prisma, userId, {
      boardId,
      mutationId: 'm1',
      taskId: task.id,
      patch: { title: 'Final', priority: 'URGENT', dueDate: '2026-12-24', description: '' },
    });
    expect(result.task).toMatchObject({
      title: 'Final',
      priority: 'URGENT',
      dueDate: '2026-12-24',
      version: 2,
    });
    expect(result.activity?.data.fields).toEqual(['title', 'priority', 'dueDate']);

    const noop = await updateTask(prisma, userId, {
      boardId,
      mutationId: 'm2',
      taskId: task.id,
      patch: { title: 'Final' },
    });
    expect(noop.activity).toBeNull();
    expect(noop.task.version).toBe(2);
  });

  it('only allows workspace members as assignees', async () => {
    const task = await addTask('Assign me');
    const outsider = await prisma.user.create({
      data: { name: 'Out', email: 'out@test.dev', avatarColor: '#000000' },
    });
    await expect(
      updateTask(prisma, userId, {
        boardId,
        mutationId: 'm',
        taskId: task.id,
        patch: { assigneeId: outsider.id },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const assigned = await updateTask(prisma, userId, {
      boardId,
      mutationId: 'm',
      taskId: task.id,
      patch: { assigneeId: userId },
    });
    expect(assigned.task.assigneeId).toBe(userId);
  });

  it('treats a retried create (same id) as idempotent', async () => {
    const id = randomUUID();
    const input = {
      boardId,
      mutationId: 'm',
      task: {
        id,
        columnId: todo(),
        title: 'Once',
        description: '',
        priority: 'LOW' as const,
        assigneeId: null,
        dueDate: null,
      },
    };
    const [one, two] = await Promise.all([
      createTask(prisma, userId, input),
      createTask(prisma, userId, input),
    ]);
    expect(one.task.id).toBe(id);
    expect(two.task.id).toBe(id);
    expect(await prisma.task.count({ where: { id } })).toBe(1);
  });

  it('deletes tasks', async () => {
    const task = await addTask('Bye');
    const result = await deleteTask(prisma, userId, { boardId, mutationId: 'm', taskId: task.id });
    expect(result.activity.type).toBe('task.deleted');
    await expect(
      deleteTask(prisma, userId, { boardId, mutationId: 'm', taskId: task.id }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('columns', () => {
  it('creates, reorders and deletes columns (deleting their tasks)', async () => {
    const id = randomUUID();
    await createColumn(prisma, userId, {
      boardId,
      mutationId: 'm',
      column: { id, name: 'Review' },
    });
    await moveColumn(prisma, userId, {
      boardId,
      mutationId: 'm',
      columnId: id,
      afterId: null,
      beforeId: todo(),
    });
    const names = sortByPosition(await prisma.column.findMany({ where: { boardId } })).map(
      (c) => c.name,
    );
    expect(names).toEqual(['Review', 'To do', 'In progress', 'Done']);

    const task = await addTask('Gone soon', id);
    const result = await deleteColumn(prisma, userId, { boardId, mutationId: 'm', columnId: id });
    expect(result.taskIds).toEqual([task.id]);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);
  });
});
