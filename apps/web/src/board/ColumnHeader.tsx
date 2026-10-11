import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { LIMITS, type ColumnDTO } from '@flowsync/shared';
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Menu } from '../components/Menu';
import { Button } from '../components/ui';
import { boardActions } from '../sync/board-store';

export interface DragHandle {
  ref?: (element: HTMLElement | null) => void;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
}

export function ColumnHeader({
  column,
  count,
  handle,
}: {
  column: ColumnDTO;
  count: number;
  handle?: DragHandle;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function save(value: string) {
    setEditing(false);
    const name = value.trim();
    if (name && name !== column.name) boardActions.renameColumn(column.id, name);
  }

  return (
    <div className="flex items-center gap-1 px-2 pb-2 pt-2.5">
      {handle && (
        <button
          type="button"
          ref={handle.ref}
          {...handle.attributes}
          {...handle.listeners}
          aria-label={`Reorder column ${column.name}`}
          title="Drag to reorder"
          className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      {editing ? (
        <input
          autoFocus
          defaultValue={column.name}
          maxLength={LIMITS.columnName}
          aria-label="Column name"
          onBlur={(e) => save(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(e.currentTarget.value);
            if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-brand-400 bg-white px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-950"
        />
      ) : (
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename column"
            className="max-w-full truncate rounded-md px-1 py-0.5 text-left text-sm font-semibold hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            {column.name}
          </button>
        </h2>
      )}
      <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {count}
      </span>
      <Menu
        label={`Column actions for ${column.name}`}
        trigger={<MoreHorizontal className="size-4" aria-hidden />}
        items={[
          {
            label: 'Rename',
            icon: <Pencil className="size-4" aria-hidden />,
            onSelect: () => setEditing(true),
          },
          {
            label: 'Delete column',
            icon: <Trash2 className="size-4" aria-hidden />,
            danger: true,
            onSelect: () =>
              count > 0 ? setConfirming(true) : boardActions.deleteColumn(column.id),
          },
        ]}
      />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete “${column.name}”?`}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This also deletes its {count} {count === 1 ? 'task' : 'tasks'}, for everyone on the board.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false);
              boardActions.deleteColumn(column.id);
            }}
          >
            Delete column
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function AddColumn() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-72 shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-300"
      >
        + Add column
      </button>
    );
  }
  const save = (value: string) => {
    const name = value.trim();
    if (name) boardActions.createColumn(name);
    setOpen(false);
  };
  return (
    <div className="w-72 shrink-0 rounded-2xl bg-slate-100/80 p-2 dark:bg-slate-900/60">
      <input
        autoFocus
        aria-label="New column name"
        placeholder="Column name"
        maxLength={LIMITS.columnName}
        onBlur={(e) => save(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save(e.currentTarget.value);
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-full rounded-lg border border-brand-400 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-950"
      />
    </div>
  );
}
