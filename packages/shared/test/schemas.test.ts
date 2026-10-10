import { describe, expect, it } from 'vitest';
import { describeActivity } from '../src/activity.js';
import { initials } from '../src/index.js';
import {
  cursorMoveSchema,
  fieldErrors,
  signupSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskUpdateSchema,
} from '../src/schemas.js';

const boardId = '7b0c6f53-3c4f-4c5b-9f1d-2f9b8d2e6a11';
const taskId = 'c2a8e5a0-4f5e-4b8e-9a43-6a1a1c9d2b33';
const columnId = '0a9d2c34-1f2e-4f3a-8b5c-7d6e5f4a3b22';

describe('signupSchema', () => {
  it('normalises email and trims the name', () => {
    const parsed = signupSchema.parse({
      name: '  Ada Lovelace ',
      email: 'Ada@Example.COM',
      password: 'correct horse',
    });
    expect(parsed).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct horse',
    });
  });

  it('reports field errors', () => {
    const result = signupSchema.safeParse({ name: '', email: 'nope', password: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(fieldErrors(result.error)).sort()).toEqual(['email', 'name', 'password']);
    }
  });
});

describe('task payloads', () => {
  it('applies defaults on create', () => {
    const parsed = taskCreateSchema.parse({
      boardId,
      mutationId: 'm1',
      task: { id: taskId, columnId, title: ' Ship it ' },
    });
    expect(parsed.task).toMatchObject({
      title: 'Ship it',
      description: '',
      priority: 'MEDIUM',
      assigneeId: null,
      dueDate: null,
    });
  });

  it('rejects an empty patch and bad dates', () => {
    expect(
      taskUpdateSchema.safeParse({ boardId, mutationId: 'm', taskId, patch: {} }).success,
    ).toBe(false);
    expect(
      taskUpdateSchema.safeParse({
        boardId,
        mutationId: 'm',
        taskId,
        patch: { dueDate: '2026-13-40' },
      }).success,
    ).toBe(false);
    expect(
      taskUpdateSchema.safeParse({
        boardId,
        mutationId: 'm',
        taskId,
        patch: { dueDate: '2026-10-31' },
      }).success,
    ).toBe(true);
  });

  it('requires explicit null anchors on move', () => {
    expect(
      taskMoveSchema.safeParse({ boardId, mutationId: 'm', taskId, toColumnId: columnId }).success,
    ).toBe(false);
    expect(
      taskMoveSchema.safeParse({
        boardId,
        mutationId: 'm',
        taskId,
        toColumnId: columnId,
        afterId: null,
        beforeId: null,
      }).success,
    ).toBe(true);
  });

  it('rejects non-uuid ids', () => {
    expect(
      taskMoveSchema.safeParse({
        boardId: 'not-a-uuid',
        mutationId: 'm',
        taskId,
        toColumnId: columnId,
        afterId: null,
        beforeId: null,
      }).success,
    ).toBe(false);
  });
});

describe('cursorMoveSchema', () => {
  it('rejects non-finite coordinates', () => {
    expect(cursorMoveSchema.safeParse({ boardId, x: Infinity, y: 1, view: 'kanban' }).success).toBe(
      false,
    );
    expect(cursorMoveSchema.safeParse({ boardId, x: 10, y: 20, view: 'kanban' }).success).toBe(
      true,
    );
  });
});

describe('describeActivity', () => {
  it('describes moves and field updates', () => {
    expect(
      describeActivity({
        type: 'task.moved',
        data: { taskTitle: 'Hero copy', fromColumn: 'To do', toColumn: 'Done' },
      }),
    ).toBe('moved “Hero copy” from To do to Done');
    expect(
      describeActivity({
        type: 'task.updated',
        data: { taskTitle: 'Hero copy', fields: ['priority', 'assigneeId', 'dueDate'] },
      }),
    ).toBe('changed the priority, assignee and due date of “Hero copy”');
  });
});

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Swift Otter', 'SO'],
    ['plato', 'P'],
    ['  ', '?'],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
