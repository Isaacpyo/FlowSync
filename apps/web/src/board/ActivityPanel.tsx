import { describeActivity } from '@flowsync/shared';
import { History } from 'lucide-react';
import { Avatar, Button, Spinner } from '../components/ui';
import { timeAgo } from '../lib/time';
import { boardActions, useBoard } from '../sync/board-store';

export function ActivityPanel() {
  const activity = useBoard((s) => s.activity);
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {!activity.loaded && activity.loading ? (
        <div className="flex justify-center py-6">
          <Spinner label="Loading activity" />
        </div>
      ) : activity.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          <History className="size-6" aria-hidden />
          Nothing has happened here yet.
        </div>
      ) : (
        <ol aria-label="Board activity" className="space-y-4">
          {activity.items.map((item) => (
            <li key={item.id} className="flex animate-fade-in gap-3">
              <Avatar
                name={item.actor?.name ?? 'Former guest'}
                color={item.actor?.avatarColor ?? '#94a3b8'}
                size="xs"
                className="mt-0.5"
              />
              <div className="min-w-0 text-sm">
                <p className="break-words">
                  <span className="font-medium">{item.actor?.name ?? 'Former guest'}</span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    {describeActivity(item)}
                  </span>
                </p>
                <time
                  dateTime={item.createdAt}
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  {timeAgo(item.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {activity.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full"
          loading={activity.loading}
          onClick={() => void boardActions.loadActivity(true)}
        >
          Load older activity
        </Button>
      )}
    </div>
  );
}
