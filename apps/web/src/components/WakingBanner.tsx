import { Coffee } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWaking } from '../lib/waking';

/**
 * Shown while a request or the socket connection is unusually slow, which on
 * Render's free tier almost always means the API is booting from sleep.
 */
export function WakingBanner() {
  const since = useWaking((s) => s.since);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);

  if (since === null) return null;
  const seconds = Math.max(0, Math.round((now - since) / 1000));

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3"
      data-testid="waking-banner"
    >
      <div className="flex max-w-xl animate-fade-in items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 shadow-lg dark:border-amber-500/30 dark:bg-amber-950 dark:text-amber-100">
        <Coffee className="size-5 shrink-0 animate-pulse" aria-hidden />
        <p>
          <span className="font-semibold">Waking the server…</span>{' '}
          <span className="text-amber-800/90 dark:text-amber-200/80">
            The free-tier API sleeps when idle; the first request takes up to a minute.
            {seconds > 0 && ` (${seconds}s)`}
          </span>
        </p>
      </div>
    </div>
  );
}
