import clsx from 'clsx';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '../lib/toast';

const icons = { info: Info, success: CheckCircle2, error: XCircle };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <Icon
              aria-hidden
              className={clsx(
                'mt-0.5 size-4 shrink-0',
                t.tone === 'error' && 'text-red-500',
                t.tone === 'success' && 'text-emerald-500',
                t.tone === 'info' && 'text-brand-500',
              )}
            />
            <p className="flex-1">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
