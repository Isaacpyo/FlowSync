import type { BoardView, PresenceUser } from '@flowsync/shared';
import clsx from 'clsx';
import { ChevronRight, History, KanbanSquare, List, MessageSquare, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { Avatar, IconButton } from '../components/ui';
import { useConnection } from '../lib/socket';
import { boardActions, useBoard } from '../sync/board-store';

export function BoardHeader({
  view,
  onViewChange,
}: {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
}) {
  const meta = useBoard((s) => s.meta);
  const panel = useBoard((s) => s.panel);
  const unread = useBoard((s) => s.chat.unread);
  if (!meta) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
      <div className="min-w-0 flex-1 basis-48">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center text-xs text-slate-500 dark:text-slate-400"
        >
          <Link
            to={`/w/${meta.workspaceId}`}
            className="truncate hover:text-slate-900 hover:underline dark:hover:text-white"
          >
            {meta.workspaceName}
          </Link>
          <ChevronRight className="mx-0.5 size-3.5 shrink-0" aria-hidden />
        </nav>
        <h1 className="truncate text-lg font-semibold leading-tight">{meta.name}</h1>
      </div>

      <PresenceStack />

      <div
        role="group"
        aria-label="View"
        className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
      >
        {(
          [
            { id: 'kanban', label: 'Board', icon: KanbanSquare },
            { id: 'list', label: 'List', icon: List },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => onViewChange(id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium',
              view === id
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            <span className="sr-only sm:hidden">{label} view</span>
          </button>
        ))}
      </div>

      <SyncStatus />

      <div className="flex items-center">
        <IconButton
          label={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
          active={panel === 'chat'}
          onClick={() => boardActions.setPanel(panel === 'chat' ? null : 'chat')}
        >
          <MessageSquare className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </IconButton>
        <IconButton
          label="Activity"
          active={panel === 'activity'}
          onClick={() => boardActions.setPanel(panel === 'activity' ? null : 'activity')}
        >
          <History className="size-5" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function PresenceStack() {
  const presence = useBoard((s) => s.presence);
  const me = useBoard((s) => s.me);
  const max = 4;
  const label = (u: PresenceUser) =>
    `${u.userId === me?.id ? `${u.name} (you)` : u.name}${u.connections > 1 ? `, ${u.connections} tabs` : ''}`;
  return (
    <div
      className="flex items-center"
      data-testid="presence"
      data-count={presence.length}
      aria-label={`${presence.length} ${presence.length === 1 ? 'person' : 'people'} on this board`}
      role="group"
    >
      <div className="flex -space-x-2">
        {presence.slice(0, max).map((u) => (
          <Avatar
            key={u.userId}
            name={u.name}
            color={u.avatarColor}
            title={label(u)}
            className="ring-2 ring-white dark:ring-slate-950"
          />
        ))}
      </div>
      {presence.length > max && (
        <span
          className="ml-1 text-xs font-medium text-slate-500"
          title={presence.slice(max).map(label).join(', ')}
        >
          +{presence.length - max}
        </span>
      )}
    </div>
  );
}

/** Connection state and measured sync latency (emit → server ack). */
function SyncStatus() {
  const status = useConnection((s) => s.status);
  const latency = useBoard((s) => s.latency);
  const connected = status === 'connected';
  const ms = latency.p50 ?? latency.ping;
  const tone =
    ms === null
      ? 'text-slate-500'
      : ms < 150
        ? 'text-emerald-600 dark:text-emerald-400'
        : ms < 400
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';
  const details = [
    latency.last !== null && `Last change confirmed in ${latency.last} ms`,
    latency.p50 !== null && `median ${latency.p50} ms`,
    latency.p95 !== null && `p95 ${latency.p95} ms over ${latency.count} changes`,
    latency.ping !== null && `network round trip ${latency.ping} ms`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-800"
      role="status"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={clsx(
            'size-2 rounded-full',
            connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
          )}
          aria-hidden
        />
        <span className="font-medium">
          {connected ? 'Live' : status === 'unauthorized' ? 'Signed out' : 'Connecting…'}
        </span>
      </span>
      {connected && ms !== null && (
        <span
          className={clsx('inline-flex items-center gap-0.5 font-mono', tone)}
          title={details || undefined}
          data-testid="latency"
        >
          <Zap className="size-3" aria-hidden />
          {ms} ms
          <span className="sr-only">. {details}</span>
        </span>
      )}
    </div>
  );
}
