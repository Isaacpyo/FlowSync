import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ColumnDTO, MemberDTO, TaskDTO } from '@flowsync/shared';
import clsx from 'clsx';
import { CalendarDays, GripVertical } from 'lucide-react';
import { memo, type KeyboardEvent } from 'react';
import { Avatar } from '../components/ui';
import { isOverdue, shortDate } from '../lib/time';
import { useBoard } from '../sync/board-store';
import { AddTask } from './AddTask';
import { PRIORITY_META } from './priority';
import { useBoardDnd } from './use-board-dnd';

export function ListView({
  members,
  onOpenTask,
}: {
  members: Map<string, MemberDTO>;
  onOpenTask: (taskId: string) => void;
}) {
  const ordered = useBoard((s) => s.ordered);
  const tasks = useBoard((s) => s.sync.view.tasks);
  const pendingIds = useBoard((s) => s.pendingIds);
  const { containers, active, dndProps } = useBoardDnd(ordered);
  const activeTask = active?.kind === 'task' ? tasks[active.id] : undefined;

  return (
    <DndContext {...dndProps}>
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {ordered.columns.map((column) => (
          <ListSection
            key={column.id}
            column={column}
            taskIds={containers[column.id] ?? []}
            tasks={tasks}
            members={members}
            pendingIds={pendingIds}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="rounded-xl border border-brand-300 bg-white shadow-xl ring-2 ring-brand-500/30 dark:border-brand-500/50 dark:bg-slate-900">
            <RowContent
              task={activeTask}
              assignee={activeTask.assigneeId ? members.get(activeTask.assigneeId) : undefined}
              pending={false}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const ListSection = memo(function ListSection({
  column,
  taskIds,
  tasks,
  members,
  pendingIds,
  onOpenTask,
}: {
  column: ColumnDTO;
  taskIds: string[];
  tasks: Readonly<Record<string, TaskDTO>>;
  members: Map<string, MemberDTO>;
  pendingIds: Set<string>;
  onOpenTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { type: 'column' } });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name} tasks`}
      className={clsx(
        'rounded-2xl border bg-white shadow-sm dark:bg-slate-900',
        isOver
          ? 'border-brand-400 dark:border-brand-500/60'
          : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold">{column.name}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {taskIds.length}
        </span>
      </header>
      <div className="hidden grid-cols-[1.5rem_1fr_6rem_8rem_6rem] gap-3 px-4 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid">
        <span />
        <span>Task</span>
        <span>Priority</span>
        <span>Assignee</span>
        <span>Due</span>
      </div>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-slate-100 px-2 py-1 dark:divide-slate-800/70">
          {taskIds.map((id) => {
            const task = tasks[id];
            if (!task) return null;
            return (
              <ListRow
                key={id}
                task={task}
                columnId={column.id}
                assignee={task.assigneeId ? members.get(task.assigneeId) : undefined}
                pending={pendingIds.has(id)}
                onOpen={onOpenTask}
              />
            );
          })}
          {taskIds.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-slate-400">
              No tasks. Drop one here.
            </li>
          )}
        </ul>
      </SortableContext>
      <div className="px-3 pb-3">
        <AddTask columnId={column.id} columnName={column.name} />
      </div>
    </section>
  );
});

function RowContent({
  task,
  assignee,
  pending,
}: {
  task: TaskDTO;
  assignee: MemberDTO | undefined;
  pending: boolean;
}) {
  const priority = PRIORITY_META[task.priority];
  const overdue = task.dueDate !== null && isOverdue(task.dueDate);
  return (
    <div className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-2 py-2.5 md:grid-cols-[1.5rem_1fr_6rem_8rem_6rem]">
      <GripVertical className="size-4 text-slate-300 dark:text-slate-600" aria-hidden />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{task.title}</span>
        {pending && (
          <span
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-500"
            aria-label="Saving"
            role="status"
          />
        )}
      </span>
      <span
        className={clsx(
          'inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
          priority.badge,
        )}
      >
        <span className={clsx('size-1.5 rounded-full', priority.dot)} aria-hidden />
        {priority.label}
      </span>
      <span className="hidden min-w-0 items-center gap-2 md:flex">
        {assignee ? (
          <>
            <Avatar name={assignee.name} color={assignee.avatarColor} size="xs" />
            <span className="truncate text-sm text-slate-600 dark:text-slate-300">
              {assignee.name}
            </span>
          </>
        ) : (
          <span className="text-sm text-slate-400">Unassigned</span>
        )}
      </span>
      <span
        className={clsx(
          'hidden items-center gap-1 text-sm md:flex',
          overdue ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {task.dueDate ? (
          <>
            <CalendarDays className="size-3.5" aria-hidden />
            {shortDate(task.dueDate)}
          </>
        ) : (
          '—'
        )}
      </span>
    </div>
  );
}

const ListRow = memo(function ListRow({
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
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === 'Enter' && !event.defaultPrevented) onOpen(task.id);
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(task.id)}
      aria-roledescription="draggable task"
      aria-label={`${task.title}. Press Enter to open.`}
      data-testid="task-row"
      className={clsx(
        'cursor-grab touch-manipulation rounded-lg hover:bg-slate-50 active:cursor-grabbing dark:hover:bg-slate-800/50',
        isDragging && 'opacity-40',
      )}
    >
      <RowContent task={task} assignee={assignee} pending={pending} />
    </li>
  );
});
