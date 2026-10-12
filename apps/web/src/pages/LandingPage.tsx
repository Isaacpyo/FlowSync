import { loginSchema, signupSchema, fieldErrors } from '@flowsync/shared';
import clsx from 'clsx';
import {
  Activity,
  GripVertical,
  MessagesSquare,
  MousePointer2,
  Moon,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button, Field } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { findDemoBoard } from '../lib/queries';

const FEATURES = [
  {
    icon: MousePointer2,
    title: 'Live cursors & presence',
    text: 'See who is on the board and where they are pointing.',
  },
  {
    icon: GripVertical,
    title: 'Kanban and list views',
    text: 'Drag and drop tasks and columns, on desktop or touch.',
  },
  {
    icon: Zap,
    title: 'Optimistic, conflict-safe',
    text: 'Changes show instantly; the server reconciles races.',
  },
  {
    icon: MessagesSquare,
    title: 'Team chat per board',
    text: 'Talk next to the work, with typing indicators.',
  },
  {
    icon: Activity,
    title: 'Activity log',
    text: 'Every move, edit and rename, live as it happens.',
  },
  { icon: Moon, title: 'Dark mode', text: 'Follows your system, or pick your side.' },
];

type Mode = 'login' | 'signup';

export function LandingPage() {
  const { status, login, signup, demo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState<'demo' | 'form' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (status === 'authenticated' && busy === null) return <Navigate to={from ?? '/app'} replace />;

  async function tryDemo() {
    setBusy('demo');
    setErrors({});
    try {
      await demo();
      const boardId = await findDemoBoard().catch(() => null);
      navigate(boardId ? `/b/${boardId}` : '/app', { replace: true });
    } catch (error) {
      setErrors({ _: error instanceof Error ? error.message : 'Could not start the demo' });
      setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = mode === 'login' ? loginSchema.safeParse(data) : signupSchema.safeParse(data);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setBusy('form');
    setErrors({});
    try {
      if (mode === 'login') await login(parsed.data as { email: string; password: string });
      else await signup(parsed.data as { name: string; email: string; password: string });
      navigate(from ?? '/app', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) setErrors({ ...error.fields, _: error.message });
      else setErrors({ _: 'Something went wrong' });
      setBusy(null);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.25),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.3),transparent_60%)]"
      />
      <header className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <Logo className="text-lg" />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pt-14">
        <section>
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            Real-time collaborative task management
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            Where teams{' '}
            <span className="bg-gradient-to-r from-brand-500 to-cyan-500 bg-clip-text text-transparent">
              flow together.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            FlowSync is a shared Kanban board that updates as fast as your team thinks. Everyone
            sees the same board, the same cursors and the same conversation, live.
          </p>
          <Button
            size="lg"
            className="mt-6 w-full sm:w-auto lg:hidden"
            onClick={tryDemo}
            loading={busy === 'demo'}
            disabled={busy !== null}
          >
            {busy !== 'demo' && <Sparkles className="size-5" aria-hidden />}
            Try the demo, no sign-up
          </Button>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 self-start rounded-lg bg-white p-2 text-brand-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-brand-300 dark:ring-slate-800">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="auth-heading"
          className="h-fit rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur sm:p-8 dark:border-slate-800 dark:bg-slate-900/80"
        >
          <h2 id="auth-heading" className="text-xl font-semibold">
            Jump in
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            No sign-up needed. You will join a shared demo team as a guest.
          </p>
          <Button
            size="lg"
            className="mt-5 w-full"
            onClick={tryDemo}
            loading={busy === 'demo'}
            disabled={busy !== null}
            data-testid="try-demo"
          >
            {busy !== 'demo' && <Sparkles className="size-5" aria-hidden />}
            Try the demo
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
            Tip: open it in a second browser to see live cursors and presence.
          </p>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            or use an account
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <div
            role="tablist"
            aria-label="Account"
            className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
          >
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setErrors({});
                }}
                className={clsx(
                  'rounded-md py-1.5 text-sm font-medium transition-colors',
                  mode === m
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} noValidate className="space-y-4" key={mode}>
            {mode === 'signup' && (
              <Field label="Name" name="name" autoComplete="name" required error={errors.name} />
            )}
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              error={errors.email}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              error={errors.password}
              {...(mode === 'signup' ? { hint: 'At least 8 characters.' } : {})}
            />
            {errors._ && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
              >
                {errors._}
              </p>
            )}
            <Button
              type="submit"
              variant="secondary"
              className="w-full"
              loading={busy === 'form'}
              disabled={busy !== null}
            >
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 dark:text-slate-400">
        React · Vite · Tailwind · Node.js · Socket.io · Redis · PostgreSQL · Prisma
      </footer>
    </div>
  );
}
