import { LIMITS, PRIORITIES, type MemberDTO, type Priority, type TaskDTO } from '@flowsync/shared';
import { Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Button, inputClass } from '../components/ui';
import { timeAgo } from '../lib/time';
import { boardActions, useBoard } from '../sync/board-store';
import { PRIORITY_META } from './priority';

/**
 * Task details. Selects save immediately; text fields save on blur. Every
 * save is an optimistic mutation, so others see it within a round trip and
 * this dialog keeps reflecting their changes while it is open.
 */
export function TaskDialog({
  taskId,
  members,
  onClose,
}: {
  taskId: string | null;
  members: MemberDTO[];
  onClose: () => void;
}) {
  const task = useBoard((s) => (taskId ? s.sync.view.tasks[taskId] : undefined));
  const deleted = taskId !== null && task === undefined;

  useEffect(() => {
    if (deleted) onClose();
  }, [deleted, onClose]);

  return (
    <Dialog open={task !== undefined} onClose={onClose} title="Task details" wide>
      {task && <TaskForm key={task.id} task={task} members={members} onClose={onClose} />}
    </Dialog>
  );
}

function TaskForm({
  task,
  members,
  onClose,
}: {
  task: TaskDTO;
  members: MemberDTO[];
  onClose: () => void;
}) {
  const columns = useBoard((s) => s.ordered.columns);
  const tasksByColumn = useBoard((s) => s.ordered.tasksByColumn);
  const pending = useBoard((s) => s.pendingIds.has(task.id));
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = {
    title: useId(),
    description: useId(),
    status: useId(),
    priority: useId(),
    assignee: useId(),
    due: useId(),
  };

  // Pick up remote edits to fields the user is not currently editing.
  useEffect(() => {
    if (document.activeElement?.id !== ids.title) setTitle(task.title);
  }, [task.title, ids.title]);
  useEffect(() => {
    if (document.activeElement?.id !== ids.description) setDescription(task.description);
  }, [task.description, ids.description]);

  function moveTo(columnId: string) {
    if (columnId === task.columnId) return;
    const target = (tasksByColumn[columnId] ?? []).filter((t) => t.id !== task.id);
    boardActions.moveTask(task.id, columnId, {
      afterId: target[target.length - 1]?.id ?? null,
      beforeId: null,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor={ids.title}
          className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Title
        </label>
        <input
          id={ids.title}
          value={title}
          maxLength={LIMITS.taskTitle}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const value = title.trim();
            if (value && value !== task.title) boardActions.updateTask(task.id, { title: value });
            else setTitle(task.title);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`${inputClass} text-base font-medium`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={ids.status}
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Status
          </label>
          <select
            id={ids.status}
            value={task.columnId}
            onChange={(e) => moveTo(e.target.value)}
            className={inputClass}
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={ids.priority}
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Priority
          </label>
          <select
            id={ids.priority}
            value={task.priority}
            onChange={(e) =>
              boardActions.updateTask(task.id, { priority: e.target.value as Priority })
            }
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={ids.assignee}
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Assignee
          </label>
          <select
            id={ids.assignee}
            value={task.assigneeId ?? ''}
            onChange={(e) =>
              boardActions.updateTask(task.id, { assigneeId: e.target.value || null })
            }
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={ids.due}
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Due date
          </label>
          <input
            id={ids.due}
            type="date"
            value={task.dueDate ?? ''}
            onChange={(e) => boardActions.updateTask(task.id, { dueDate: e.target.value || null })}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={ids.description}
          className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Description
        </label>
        <textarea
          id={ids.description}
          value={description}
          rows={5}
          maxLength={LIMITS.taskDescription}
          placeholder="Add more detail…"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description.trim() !== task.description) {
              boardActions.updateTask(task.id, { description: description.trim() });
            }
          }}
          className={`${inputClass} resize-y`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>
          Created {timeAgo(task.createdAt)} · updated {timeAgo(task.updatedAt)}
        </span>
        <span role="status" className="text-brand-600 dark:text-brand-400">
          {pending ? 'Saving…' : ''}
        </span>
        <div className="ml-auto flex gap-2">
          {confirmDelete ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  boardActions.deleteTask(task.id);
                  onClose();
                }}
              >
                Delete for everyone
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-red-600 dark:text-red-400"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
