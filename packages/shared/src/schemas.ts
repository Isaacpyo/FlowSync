import { z } from 'zod';

/**
 * Validation for every payload that crosses the API boundary (REST bodies,
 * query strings and Socket.io events). The web app reuses the same schemas
 * for its forms so client and server agree on limits.
 */

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

export const BOARD_VIEWS = ['kanban', 'list'] as const;
export const boardViewSchema = z.enum(BOARD_VIEWS);
export type BoardView = z.infer<typeof boardViewSchema>;

export const LIMITS = {
  userName: 60,
  password: { min: 8, max: 128 },
  workspaceName: 80,
  boardName: 80,
  boardDescription: 500,
  columnName: 60,
  taskTitle: 200,
  taskDescription: 5000,
  chatMessage: 2000,
} as const;

const idSchema = z.uuid();
const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const emailSchema = z
  .email('Enter a valid email')
  .max(254)
  .transform((value) => value.toLowerCase());
const mutationIdSchema = z.string().min(1).max(64);
/** Calendar date, `YYYY-MM-DD`. */
const dateSchema = z.iso.date();

// ---------------------------------------------------------------- auth

export const signupSchema = z.object({
  name: text(LIMITS.userName),
  email: emailSchema,
  password: z
    .string()
    .min(LIMITS.password.min, `At least ${LIMITS.password.min} characters`)
    .max(LIMITS.password.max),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required').max(LIMITS.password.max),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------- workspaces & boards

export const createWorkspaceSchema = z.object({
  name: text(LIMITS.workspaceName),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createBoardSchema = z.object({
  name: text(LIMITS.boardName),
  description: z.string().trim().max(LIMITS.boardDescription).default(''),
});
export type CreateBoardInput = z.input<typeof createBoardSchema>;

export const pageQuerySchema = z.object({
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const idParamSchema = z.object({ id: idSchema });

// ---------------------------------------------------------------- realtime: board

export const boardRefSchema = z.object({ boardId: idSchema });

const mutationBase = {
  boardId: idSchema,
  mutationId: mutationIdSchema,
};

const placement = {
  afterId: idSchema.nullable(),
  beforeId: idSchema.nullable(),
};

export const taskCreateSchema = z.object({
  ...mutationBase,
  task: z.object({
    /** Client-generated so the optimistic task never needs an id swap. */
    id: idSchema,
    columnId: idSchema,
    title: text(LIMITS.taskTitle),
    description: z.string().trim().max(LIMITS.taskDescription).default(''),
    priority: prioritySchema.default('MEDIUM'),
    assigneeId: idSchema.nullable().default(null),
    dueDate: dateSchema.nullable().default(null),
  }),
});
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskPatchSchema = z
  .object({
    title: text(LIMITS.taskTitle),
    description: z.string().trim().max(LIMITS.taskDescription),
    priority: prioritySchema,
    assigneeId: idSchema.nullable(),
    dueDate: dateSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const taskUpdateSchema = z.object({
  ...mutationBase,
  taskId: idSchema,
  patch: taskPatchSchema,
});
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;

export const taskMoveSchema = z.object({
  ...mutationBase,
  taskId: idSchema,
  toColumnId: idSchema,
  ...placement,
});
export type TaskMoveInput = z.input<typeof taskMoveSchema>;

export const taskDeleteSchema = z.object({
  ...mutationBase,
  taskId: idSchema,
});
export type TaskDeleteInput = z.input<typeof taskDeleteSchema>;

export const columnCreateSchema = z.object({
  ...mutationBase,
  column: z.object({
    id: idSchema,
    name: text(LIMITS.columnName),
  }),
});
export type ColumnCreateInput = z.input<typeof columnCreateSchema>;

export const columnUpdateSchema = z.object({
  ...mutationBase,
  columnId: idSchema,
  name: text(LIMITS.columnName),
});
export type ColumnUpdateInput = z.input<typeof columnUpdateSchema>;

export const columnMoveSchema = z.object({
  ...mutationBase,
  columnId: idSchema,
  ...placement,
});
export type ColumnMoveInput = z.input<typeof columnMoveSchema>;

export const columnDeleteSchema = z.object({
  ...mutationBase,
  columnId: idSchema,
});
export type ColumnDeleteInput = z.input<typeof columnDeleteSchema>;

// ---------------------------------------------------------------- realtime: chat, cursors

export const chatSendSchema = z.object({
  boardId: idSchema,
  clientId: mutationIdSchema,
  body: text(LIMITS.chatMessage),
});
export type ChatSendInput = z.input<typeof chatSendSchema>;

export const chatTypingSchema = z.object({
  boardId: idSchema,
  typing: z.boolean(),
});
export type ChatTypingInput = z.input<typeof chatTypingSchema>;

const coordinate = z.number().finite().min(-100_000).max(100_000);
export const cursorMoveSchema = z.object({
  boardId: idSchema,
  x: coordinate,
  y: coordinate,
  view: boardViewSchema,
});
export type CursorMoveInput = z.input<typeof cursorMoveSchema>;

/** Flatten zod issues into `{ field: message }` for API error bodies and forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    result[key] ??= issue.message;
  }
  return result;
}
