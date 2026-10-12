import {
  boardRefSchema,
  chatSendSchema,
  chatTypingSchema,
  columnCreateSchema,
  columnDeleteSchema,
  columnMoveSchema,
  columnUpdateSchema,
  cursorMoveSchema,
  taskCreateSchema,
  taskDeleteSchema,
  taskMoveSchema,
  taskUpdateSchema,
  type Ack,
  type ActivityDTO,
} from '@flowsync/shared';
import type { Db } from '../db.js';
import { AppError, forbidden } from '../errors.js';
import type { Logger } from '../logger.js';
import { requireBoardAccess } from '../services/access.js';
import { sendMessage } from '../services/boards.js';
import { createColumn, deleteColumn, moveColumn, renameColumn } from '../services/columns.js';
import { createTask, deleteTask, moveTask, updateTask } from '../services/tasks.js';
import { parse } from '../validate.js';
import type { CursorHub } from './cursors.js';
import { broadcastPresence, presenceFor } from './presence.js';
import { TokenBucket } from './rate-limit.js';
import { boardRoom, type ClientSocket, type IO } from './types.js';

interface HandlerDeps {
  io: IO;
  prisma: Db;
  logger: Logger;
  cursors: CursorHub;
}

/**
 * Run a handler and answer through the Socket.io acknowledgement callback.
 * Errors become `{ ok: false }` acks; unexpected ones are logged and masked.
 */
async function respond<T>(ack: unknown, logger: Logger, work: () => Promise<T>): Promise<void> {
  if (typeof ack !== 'function') return; // every request event must carry an ack
  const reply = ack as (response: Ack<T>) => void;
  try {
    reply({ ok: true, data: await work() });
  } catch (error) {
    if (error instanceof AppError) {
      reply({ ok: false, error: { code: error.code, message: error.message } });
    } else {
      logger.error({ err: error }, 'socket handler failed');
      reply({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
    }
  }
}

export function registerHandlers(socket: ClientSocket, deps: HandlerDeps): void {
  const { io, prisma, cursors } = deps;
  const user = socket.data.user;
  const logger = deps.logger.child({ socketId: socket.id, userId: user.id });

  const buckets = {
    mutation: new TokenBucket(40, 20),
    chat: new TokenBucket(8, 1),
    typing: new TokenBucket(5, 2),
  };

  /** The socket may only act on the one board it joined (after an access check). */
  function guard(boardId: string, bucket: TokenBucket): void {
    if (socket.data.boardId !== boardId || !socket.rooms.has(boardRoom(boardId))) {
      throw forbidden('Join the board first');
    }
    if (!bucket.take()) throw new AppError('RATE_LIMITED', 'Slow down a little');
  }

  function publishActivity(activity: ActivityDTO | null): void {
    if (activity) io.to(boardRoom(activity.boardId)).emit('activity:new', { activity });
  }

  async function leaveBoard(boardId: string): Promise<void> {
    await socket.leave(boardRoom(boardId));
    if (socket.data.boardId === boardId) delete socket.data.boardId;
    cursors.remove(boardId, socket.id);
    await broadcastPresence(io, boardId, logger);
  }

  // ---------------------------------------------------------------- membership

  socket.on('board:join', (payload, ack) =>
    respond(ack, logger, async () => {
      const { boardId } = parse(boardRefSchema, payload);
      await requireBoardAccess(prisma, user.id, boardId);
      const previous = socket.data.boardId;
      if (previous && previous !== boardId) await leaveBoard(previous);
      socket.data.boardId = boardId;
      await socket.join(boardRoom(boardId));
      const presence = await presenceFor(io, boardId, logger);
      socket.to(boardRoom(boardId)).emit('presence:update', { boardId, users: presence });
      return { presence };
    }),
  );

  socket.on('board:leave', (payload) => {
    const parsed = boardRefSchema.safeParse(payload);
    if (parsed.success && socket.data.boardId === parsed.data.boardId) {
      void leaveBoard(parsed.data.boardId).catch((err) => logger.warn({ err }, 'leave failed'));
    }
  });

  socket.on('disconnect', () => {
    const boardId = socket.data.boardId;
    if (!boardId) return;
    cursors.remove(boardId, socket.id);
    void broadcastPresence(io, boardId, logger).catch((err) =>
      logger.warn({ err }, 'presence broadcast failed'),
    );
  });

  // ---------------------------------------------------------------- tasks

  socket.on('task:create', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(taskCreateSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { task, activity } = await createTask(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('task:upserted', { task, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return task;
    }),
  );

  socket.on('task:update', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(taskUpdateSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { task, activity } = await updateTask(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('task:upserted', { task, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return task;
    }),
  );

  socket.on('task:move', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(taskMoveSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { task, activity } = await moveTask(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('task:upserted', { task, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return task;
    }),
  );

  socket.on('task:delete', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(taskDeleteSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { taskId, activity } = await deleteTask(prisma, user.id, input);
      socket.to(boardRoom(input.boardId)).emit('task:deleted', {
        taskId,
        boardId: input.boardId,
        mutationId: input.mutationId,
        actorId: user.id,
      });
      publishActivity(activity);
      return { taskId };
    }),
  );

  // ---------------------------------------------------------------- columns

  socket.on('column:create', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(columnCreateSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { column, activity } = await createColumn(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('column:upserted', { column, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return column;
    }),
  );

  socket.on('column:update', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(columnUpdateSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { column, activity } = await renameColumn(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('column:upserted', { column, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return column;
    }),
  );

  socket.on('column:move', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(columnMoveSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { column, activity } = await moveColumn(prisma, user.id, input);
      socket
        .to(boardRoom(input.boardId))
        .emit('column:upserted', { column, mutationId: input.mutationId, actorId: user.id });
      publishActivity(activity);
      return column;
    }),
  );

  socket.on('column:delete', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(columnDeleteSchema, payload);
      guard(input.boardId, buckets.mutation);
      const { columnId, taskIds, activity } = await deleteColumn(prisma, user.id, input);
      socket.to(boardRoom(input.boardId)).emit('column:deleted', {
        columnId,
        taskIds,
        boardId: input.boardId,
        mutationId: input.mutationId,
        actorId: user.id,
      });
      publishActivity(activity);
      return { columnId };
    }),
  );

  // ---------------------------------------------------------------- chat

  socket.on('chat:send', (payload, ack) =>
    respond(ack, logger, async () => {
      const input = parse(chatSendSchema, payload);
      guard(input.boardId, buckets.chat);
      const message = await sendMessage(prisma, user.id, input.boardId, input.body);
      socket.to(boardRoom(input.boardId)).emit('chat:message', { message });
      return { ...message, clientId: input.clientId };
    }),
  );

  socket.on('chat:typing', (payload) => {
    const parsed = chatTypingSchema.safeParse(payload);
    if (!parsed.success || socket.data.boardId !== parsed.data.boardId) return;
    if (!buckets.typing.take()) return;
    socket
      .to(boardRoom(parsed.data.boardId))
      .emit('chat:typing', { userId: user.id, name: user.name, typing: parsed.data.typing });
  });

  // ---------------------------------------------------------------- cursors & latency

  socket.on('cursor:move', (payload) => {
    const parsed = cursorMoveSchema.safeParse(payload);
    if (!parsed.success || socket.data.boardId !== parsed.data.boardId) return;
    const { boardId, x, y, view } = parsed.data;
    cursors.update(boardId, {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      color: user.avatarColor,
      x,
      y,
      view,
    });
  });

  socket.on('cursor:leave', (payload) => {
    const parsed = boardRefSchema.safeParse(payload);
    if (parsed.success && socket.data.boardId === parsed.data.boardId) {
      cursors.remove(parsed.data.boardId, socket.id);
    }
  });

  socket.on('sync:ping', (sentAt, ack) => {
    if (typeof ack === 'function' && typeof sentAt === 'number') ack(sentAt);
  });
}
