import {
  closestCenter,
  getFirstCollision,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { intentAt } from '@flowsync/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { boardActions, useBoard } from '../sync/board-store';
import type { OrderedBoard } from '../sync/engine';

export type DragKind = 'task' | 'column';
type Containers = Record<string, string[]>;

const kindOf = (data: { current?: Record<string, unknown> | null } | null | undefined) =>
  data?.current?.type as DragKind | undefined;

/**
 * Drag-and-drop for tasks across columns (Kanban and list) and for columns
 * (Kanban). While a task is dragged, a local copy of the per-column id lists
 * is rearranged so the drop preview is live; on drop the final index becomes
 * a placement intent ({ afterId, beforeId }) for the optimistic store.
 */
export function useBoardDnd(ordered: OrderedBoard) {
  const [dragging, setDragging] = useState<Containers | null>(null);
  const [active, setActive] = useState<{ kind: DragKind; id: string } | null>(null);
  const origin = useRef<{ columnId: string; index: number } | null>(null);

  const base = useMemo<Containers>(
    () =>
      Object.fromEntries(
        ordered.columns.map((c) => [c.id, (ordered.tasksByColumn[c.id] ?? []).map((t) => t.id)]),
      ),
    [ordered],
  );
  const containers = dragging ?? base;
  const containersRef = useRef(containers);
  containersRef.current = containers;

  const findContainer = useCallback((id: UniqueIdentifier): string | undefined => {
    const current = containersRef.current;
    const key = String(id);
    if (key in current) return key;
    return Object.keys(current).find((columnId) => current[columnId]?.includes(key));
  }, []);

  const sensors = useSensors(
    // Small distance so a click still opens the task.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press-and-hold on touch so the board can still be scrolled.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens a task, so only Space picks up and drops.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  /** Columns collide with columns; tasks with the task under the pointer, or a column's closest task. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    if (kindOf(args.active.data) === 'column') {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => kindOf(c.data) === 'column'),
      });
    }
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, 'id');
    if (overId === null) return [];
    const ids = containersRef.current[String(overId)];
    if (ids && ids.length > 0) {
      const closest = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))),
      })[0];
      if (closest) overId = closest.id;
    }
    return [{ id: overId }];
  }, []);

  const onDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const kind = kindOf(active.data) ?? 'task';
      setActive({ kind, id: String(active.id) });
      if (kind === 'task') {
        const columnId = findContainer(active.id);
        if (columnId) {
          origin.current = { columnId, index: base[columnId]?.indexOf(String(active.id)) ?? -1 };
        }
        setDragging(base);
      }
    },
    [base, findContainer],
  );

  const onDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over || kindOf(active.data) !== 'task') return;
      const from = findContainer(active.id);
      const to = findContainer(over.id);
      if (!from || !to || from === to) return;
      setDragging((current) => {
        const state = current ?? base;
        const fromItems = (state[from] ?? []).filter((id) => id !== String(active.id));
        const toItems = state[to] ?? [];
        const overIndex = toItems.indexOf(String(over.id));
        let index = toItems.length;
        if (overIndex >= 0) {
          const translated = active.rect.current.translated;
          const below = translated && translated.top > over.rect.top + over.rect.height / 2;
          index = overIndex + (below ? 1 : 0);
        }
        return {
          ...state,
          [from]: fromItems,
          [to]: [...toItems.slice(0, index), String(active.id), ...toItems.slice(index)],
        };
      });
    },
    [base, findContainer],
  );

  const reset = useCallback(() => {
    setDragging(null);
    setActive(null);
    origin.current = null;
  }, []);

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const kind = kindOf(active.data);
      const activeId = String(active.id);

      if (kind === 'column') {
        const ids = ordered.columns.map((c) => c.id);
        const from = ids.indexOf(activeId);
        const to = over ? ids.indexOf(String(over.id)) : -1;
        if (from >= 0 && to >= 0 && from !== to) {
          const next = arrayMove(ids, from, to).filter((id) => id !== activeId);
          boardActions.moveColumn(activeId, intentAt(next, to));
        }
        reset();
        return;
      }

      const columnId = findContainer(activeId);
      if (!columnId || !over) {
        reset();
        return;
      }
      let items = containersRef.current[columnId] ?? [];
      const overIndex = items.indexOf(String(over.id));
      const currentIndex = items.indexOf(activeId);
      if (overIndex >= 0 && currentIndex >= 0 && overIndex !== currentIndex) {
        items = arrayMove(items, currentIndex, overIndex);
      }
      const index = items.indexOf(activeId);
      const unchanged = origin.current?.columnId === columnId && origin.current.index === index;
      if (!unchanged && index >= 0) {
        boardActions.moveTask(
          activeId,
          columnId,
          intentAt(
            items.filter((id) => id !== activeId),
            index,
          ),
        );
      }
      reset();
    },
    [findContainer, ordered.columns, reset],
  );

  const announcements = useMemo<Announcements>(() => {
    const label = (id: UniqueIdentifier) => {
      const { view } = useBoard.getState().sync;
      const task = view.tasks[String(id)];
      if (task) return `task “${task.title}”`;
      const column = view.columns[String(id)];
      return column ? `column “${column.name}”` : 'item';
    };
    const where = (id: UniqueIdentifier) => {
      const columnId = findContainer(id);
      const column = columnId ? useBoard.getState().sync.view.columns[columnId] : undefined;
      return column ? ` in ${column.name}` : '';
    };
    return {
      onDragStart: ({ active }) => `Picked up ${label(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${label(active.id)} is over ${label(over.id)}${where(over.id)}.`
          : `${label(active.id)} is not over a list.`,
      onDragEnd: ({ active, over }) =>
        over
          ? `Dropped ${label(active.id)}${where(active.id)}.`
          : `${label(active.id)} was dropped back.`,
      onDragCancel: ({ active }) => `Cancelled. ${label(active.id)} returned to its place.`,
    };
  }, [findContainer]);

  return {
    containers,
    active,
    dndProps: {
      sensors,
      collisionDetection,
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel: reset,
      accessibility: {
        announcements,
        screenReaderInstructions: {
          draggable:
            'To pick up a task or column, press Space. Use the arrow keys to move it, Space to drop, or Escape to cancel. Press Enter to open a task.',
        },
      },
    },
  };
}
