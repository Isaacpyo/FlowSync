import type {
  ActivityData,
  ActivityDTO,
  ActivityType,
  AuthorDTO,
  ColumnDTO,
  MemberDTO,
  MessageDTO,
  TaskDTO,
  UserDTO,
} from '@flowsync/shared';
import type { Activity, Column, Membership, Message, Task, User } from '@prisma/client';

type Author = Pick<User, 'id' | 'name' | 'avatarColor'>;

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    isGuest: user.isGuest,
  };
}

export function toAuthorDTO(user: Author | null): AuthorDTO | null {
  return user ? { id: user.id, name: user.name, avatarColor: user.avatarColor } : null;
}

export function toMemberDTO(membership: Membership & { user: User }): MemberDTO {
  return {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    avatarColor: membership.user.avatarColor,
    role: membership.role,
  };
}

export function toColumnDTO(column: Column): ColumnDTO {
  return { id: column.id, boardId: column.boardId, name: column.name, position: column.position };
}

export function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function fromDateOnly(date: string | null): Date | null {
  return date ? new Date(`${date}T00:00:00.000Z`) : null;
}

export function toTaskDTO(task: Task): TaskDTO {
  return {
    id: task.id,
    boardId: task.boardId,
    columnId: task.columnId,
    title: task.title,
    description: task.description,
    position: task.position,
    priority: task.priority,
    assigneeId: task.assigneeId,
    dueDate: toDateOnly(task.dueDate),
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toMessageDTO(message: Message & { author: Author | null }): MessageDTO {
  return {
    id: message.id,
    boardId: message.boardId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    author: toAuthorDTO(message.author),
  };
}

export function toActivityDTO(activity: Activity & { actor: Author | null }): ActivityDTO {
  return {
    id: activity.id,
    boardId: activity.boardId,
    type: activity.type as ActivityType,
    data: (activity.data ?? {}) as ActivityData,
    createdAt: activity.createdAt.toISOString(),
    actor: toAuthorDTO(activity.actor),
  };
}

export const authorSelect = { id: true, name: true, avatarColor: true } as const;
