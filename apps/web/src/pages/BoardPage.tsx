import type { BoardView, MemberDTO } from '@flowsync/shared';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { EmptyState, ErrorState } from '../components/ui';
import { BoardHeader } from '../board/BoardHeader';
import { CursorLayer } from '../board/CursorLayer';
import { useCursorBroadcast } from '../board/use-cursor-broadcast';
import { KanbanView } from '../board/KanbanView';
import { ListView } from '../board/ListView';
import { SidePanel } from '../board/SidePanel';
import { TaskDialog } from '../board/TaskDialog';
import { useAuth } from '../lib/auth-context';
import { boardActions, openBoard, useBoard } from '../sync/board-store';

const VIEW_KEY = 'flowsync.view';

function readView(): BoardView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'kanban';
  } catch {
    return 'kanban';
  }
}

export function BoardPage() {
  const { boardId = '' } = useParams();
  const { user } = useAuth();
  const status = useBoard((s) => s.status);
  const error = useBoard((s) => s.error);
  const meta = useBoard((s) => s.meta);
  const [view, setView] = useState<BoardView>(readView);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    return openBoard(boardId, { id: user.id, name: user.name, avatarColor: user.avatarColor });
  }, [boardId, user]);

  useCursorBroadcast(surface, view);

  const members = useMemo(
    () => new Map<string, MemberDTO>((meta?.members ?? []).map((m) => [m.id, m])),
    [meta?.members],
  );
  const changeView = useCallback((next: BoardView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  }, []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);

  return (
    <AppShell wide>
      {status === 'loading' || status === 'idle' ? (
        <BoardSkeleton />
      ) : status === 'error' ? (
        <ErrorState
          title="Could not open this board"
          message={error ?? undefined}
          onRetry={boardActions.retry}
        />
      ) : status === 'deleted' ? (
        <div className="p-6">
          <EmptyState
            icon={<Trash2 className="size-6" aria-hidden />}
            title="This board was deleted"
            description="Someone with owner access removed it."
            action={
              <Link
                to={meta ? `/w/${meta.workspaceId}` : '/app'}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Back to the workspace
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
          <BoardHeader view={view} onViewChange={changeView} />
          <div className="flex min-h-0 flex-1">
            <div
              className="scrollbar-thin min-w-0 flex-1 snap-x scroll-pl-4 overflow-auto md:snap-none"
              data-testid="board-canvas"
            >
              <div
                ref={setSurface}
                className={`relative min-h-full p-4 ${view === 'kanban' ? 'w-max min-w-full' : 'w-full'}`}
              >
                {view === 'kanban' ? (
                  <KanbanView members={members} onOpenTask={setOpenTaskId} />
                ) : (
                  <ListView members={members} onOpenTask={setOpenTaskId} />
                )}
                <CursorLayer view={view} />
              </div>
            </div>
            <SidePanel />
          </div>
        </div>
      )}
      <TaskDialog taskId={openTaskId} members={meta?.members ?? []} onClose={closeTask} />
    </AppShell>
  );
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading board" className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="space-y-1.5">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden p-4">
        {[5, 3, 4].map((cards, i) => (
          <div
            key={i}
            className="w-72 shrink-0 space-y-2 rounded-2xl bg-slate-100/80 p-3 dark:bg-slate-900/60"
          >
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            {Array.from({ length: cards }, (_, j) => (
              <div key={j} className="h-16 animate-pulse rounded-xl bg-white dark:bg-slate-900" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
