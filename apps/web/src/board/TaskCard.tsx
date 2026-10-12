import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MemberDTO, TaskDTO } from '@flowsync/shared';
import clsx from 'clsx';
import { AlignLeft, CalendarDays } from 'lucide-react';
import { memo, type KeyboardEvent } from 'react';
import { Avatar } from '../components/ui';
import { isOverdue, shortDate } from '../lib/time';
import { PRIORITY_META } from './priority';

export function TaskMeta({ task, assignee }: { task: TaskDTO; assignee: MemberDTO | undefined }) {
  const priority = PRIORITY_META[task.priority];
  const overdue = task.dueDate !== null && isOverdue(task.dueDate);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={clsx(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
          priority.badge,
        )}
      >
        <span className={clsx('size-1.5 rounded-full', priority.dot)} aria-hidden />
        {priority.label}
      </span>
      {task.dueDate && (
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
            overdue
              ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
          )}
          title={overdue ? 'Overdue' : 'Due date'}
        >
          <CalendarDays className="size-3" aria-hidden />
          {shortDate(task.dueDate)}
        </span>
      )}
      {task.description && (
        <AlignLeft className="size-3.5 text-slate-400" aria-label="Has a description" role="img" />
      )}
      {assignee && (
        <Avatar
          name={assignee.name}
          color={assignee.avatarColor}
          size="xs"
          className="ml-auto"
          title={`Assigned to ${assignee.name}`}
        />
      )}
    </div>
  );
}

export function TaskCardBody({
  task,
  assignee,
  pending,
  overlay = false,
}: {
  task: TaskDTO;
  assignee: MemberDTO | undefined;
  pending: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative rounded-xl border bg-white p-3 text-left shadow-sm dark:bg-slate-900',
        overlay
          ? 'rotate-2 border-brand-300 shadow-xl ring-2 ring-brand-500/30 dark:border-brand-500/50'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
      )}
    >
      {pending && (
        <span
          className="absolute right-2 top-2 size-1.5 animate-pulse rounded-full bg-brand-500"
          title="Saving…"
          aria-label="Saving"
          role="status"
        />
      )}
      <p className="pr-3 text-sm font-medium leading-snug break-words">{task.title}</p>
      <div className="mt-2">
        <TaskMeta task={task} assignee={assignee} />
      </div>
    </div>
  );
}

export const SortableTaskCard = memo(function SortableTaskCard({
  task,
  columnId,
  assignee,
  pending,
  onOpen,
}: {
  task: TaskDTO;
  columnId: string;
  assignee: MemberDTO | undefined;
  pending: boolean;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === 'Enter' && !event.defaultPrevented) onOpen(task.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(task.id)}
      aria-roledescription="draggable task"
      aria-label={`${task.title}. Press Enter to open.`}
      data-testid="task-card"
      data-task-id={task.id}
      className={clsx(
        'cursor-grab touch-manipulation rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <TaskCardBody task={task} assignee={assignee} pending={pending} />
    </div>
  );
});
