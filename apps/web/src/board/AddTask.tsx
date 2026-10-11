import { LIMITS } from '@flowsync/shared';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { inputClass } from '../components/ui';
import { boardActions } from '../sync/board-store';

/** Inline "add a task" form; stays open after submitting for quick entry. */
export function AddTask({ columnId, columnName }: { columnId: string; columnName: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    boardActions.createTask(columnId, value);
    setTitle('');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <Plus className="size-4" aria-hidden />
        Add task
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="sr-only" htmlFor={`add-${columnId}`}>
        New task in {columnName}
      </label>
      <input
        id={`add-${columnId}`}
        autoFocus
        value={title}
        maxLength={LIMITS.taskTitle}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setTitle('');
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        placeholder="What needs doing?"
        className={inputClass}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 dark:bg-brand-500"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle('');
          }}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
