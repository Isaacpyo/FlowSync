import { DndContext, DragOverlay } from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ColumnDTO, MemberDTO, TaskDTO } from '@flowsync/shared';
import clsx from 'clsx';
import { memo } from 'react';
import { useBoard } from '../sync/board-store';
import { AddTask } from './AddTask';
import { AddColumn, ColumnHeader } from './ColumnHeader';
import { SortableTaskCard, TaskCardBody } from './TaskCard';
import { useBoardDnd } from './use-board-dnd';

export function KanbanView({
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
  const activeColumn =
    active?.kind === 'column' ? ordered.columns.find((c) => c.id === active.id) : undefined;

  return (
    <DndContext {...dndProps}>
      <SortableContext
        items={ordered.columns.map((c) => c.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-start gap-4">
          {ordered.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              taskIds={containers[column.id] ?? []}
              tasks={tasks}
              members={members}
              pendingIds={pendingIds}
              onOpenTask={onOpenTask}
            />
          ))}
          <AddColumn />
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activeTask ? (
          <div className="w-[17rem]">
            <TaskCardBody
              task={activeTask}
              assignee={activeTask.assigneeId ? members.get(activeTask.assigneeId) : undefined}
              pending={false}
              overlay
            />
          </div>
        ) : activeColumn ? (
          <div className="w-72 rotate-1 rounded-2xl bg-slate-100 p-3 shadow-xl ring-2 ring-brand-500/30 dark:bg-slate-900">
            <p className="text-sm font-semibold">{activeColumn.name}</p>
            <p className="text-xs text-slate-500">
              {(containers[activeColumn.id] ?? []).length} tasks
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const KanbanColumn = memo(function KanbanColumn({
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
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column' },
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={`${column.name} column`}
      data-testid="column"
      data-column-name={column.name}
      className={clsx(
        'flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-slate-100/80 dark:bg-slate-900/60',
        isDragging && 'opacity-40',
      )}
    >
      <ColumnHeader
        column={column}
        count={taskIds.length}
        handle={{ ref: setActivatorNodeRef, attributes, listeners }}
      />
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-16 flex-col gap-2 px-2 pb-1">
          {taskIds.map((id) => {
            const task = tasks[id];
            if (!task) return null;
            return (
              <SortableTaskCard
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
            <p className="rounded-xl border-2 border-dashed border-slate-300/80 px-3 py-5 text-center text-xs text-slate-400 dark:border-slate-700">
              Drop tasks here
            </p>
          )}
        </div>
      </SortableContext>
      <div className="px-2 pb-2 pt-1">
        <AddTask columnId={column.id} columnName={column.name} />
      </div>
    </section>
  );
});
