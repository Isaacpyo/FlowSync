import clsx from 'clsx';
import { X } from 'lucide-react';
import { IconButton } from '../components/ui';
import { boardActions, useBoard, type Panel } from '../sync/board-store';
import { ActivityPanel } from './ActivityPanel';
import { ChatPanel } from './ChatPanel';

const TABS: { id: Exclude<Panel, null>; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
];

/** Chat + activity drawer: a sidebar on large screens, a full-screen sheet on phones. */
export function SidePanel() {
  const panel = useBoard((s) => s.panel);
  if (!panel) return null;
  return (
    <aside
      aria-label="Board side panel"
      className="fixed inset-0 z-40 flex flex-col bg-white lg:static lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-slate-200 dark:bg-slate-950 lg:dark:border-slate-800"
    >
      <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div role="tablist" aria-label="Panel" className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={panel === tab.id}
              onClick={() => boardActions.setPanel(tab.id)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                panel === tab.id
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <IconButton
          label="Close panel"
          className="ml-auto"
          onClick={() => boardActions.setPanel(null)}
        >
          <X className="size-5" aria-hidden />
        </IconButton>
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {panel === 'chat' ? <ChatPanel /> : <ActivityPanel />}
      </div>
    </aside>
  );
}
