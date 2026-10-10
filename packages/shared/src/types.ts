import type { BoardView, Priority } from './schemas.js';

/** Wire formats (JSON) shared by the REST API, Socket.io events and the web app. */

export type Role = 'OWNER' | 'MEMBER';

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  isGuest: boolean;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
}

export interface MemberDTO {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: Role;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  isDemo: boolean;
  role: Role;
  memberCount: number;
  boardCount: number;
}

export interface BoardSummaryDTO {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  taskCount: number;
  updatedAt: string;
}

export interface WorkspaceDetailDTO {
  workspace: WorkspaceDTO;
  members: MemberDTO[];
  boards: BoardSummaryDTO[];
}

export interface ColumnDTO {
  id: string;
  boardId: string;
  name: string;
  position: string;
}

export interface TaskDTO {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  position: string;
  priority: Priority;
  assigneeId: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Incremented on every write; lets clients drop stale, out-of-order events. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDTO {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  description: string;
  role: Role;
  columns: ColumnDTO[];
  tasks: TaskDTO[];
  members: MemberDTO[];
}

export interface AuthorDTO {
  id: string;
  name: string;
  avatarColor: string;
}

export interface MessageDTO {
  id: string;
  boardId: string;
  body: string;
  createdAt: string;
  author: AuthorDTO | null;
  /** Echo of the sender's client id so it can reconcile its optimistic copy. */
  clientId?: string;
}

export const ACTIVITY_TYPES = [
  'board.created',
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'column.created',
  'column.renamed',
  'column.moved',
  'column.deleted',
  'member.joined',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityData {
  taskId?: string;
  taskTitle?: string;
  columnId?: string;
  columnName?: string;
  fromColumn?: string;
  toColumn?: string;
  fields?: string[];
  from?: string;
  to?: string;
  boardName?: string;
  memberName?: string;
}

export interface ActivityDTO {
  id: string;
  boardId: string;
  type: ActivityType;
  data: ActivityData;
  createdAt: string;
  actor: AuthorDTO | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PresenceUser {
  userId: string;
  name: string;
  avatarColor: string;
  /** Open tabs/devices for this user on the board. */
  connections: number;
}

export interface CursorState {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  view: BoardView;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';
