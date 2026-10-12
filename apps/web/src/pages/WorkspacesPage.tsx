import { createWorkspaceSchema, fieldErrors } from '@flowsync/shared';
import { Building2, ChevronRight, LayoutGrid, Plus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Button, EmptyState, ErrorState, Field, PageLoader } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { useCreateWorkspace, useWorkspaces } from '../lib/queries';

export function WorkspacesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const create = useCreateWorkspace();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).name);
      return;
    }
    setError(undefined);
    try {
      const workspace = await create.mutateAsync(parsed.data.name);
      form.reset();
      navigate(`/w/${workspace.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the workspace');
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {user ? `Welcome, ${user.name.split(' ')[0]}` : 'Your workspaces'}
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Pick a workspace or start a new one.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section aria-labelledby="ws-heading">
            <h2 id="ws-heading" className="sr-only">
              Workspaces
            </h2>
            {workspaces.isPending ? (
              <PageLoader label="Loading workspaces" />
            ) : workspaces.isError ? (
              <ErrorState
                message={workspaces.error.message}
                onRetry={() => void workspaces.refetch()}
              />
            ) : workspaces.data.length === 0 ? (
              <EmptyState
                icon={<Building2 className="size-6" aria-hidden />}
                title="No workspaces yet"
                description="Create one to start organising boards with your team."
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {workspaces.data.map((ws) => (
                  <li key={ws.id}>
                    <Link
                      to={`/w/${ws.id}`}
                      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-lg font-semibold">{ws.name}</span>
                        <ChevronRight
                          className="size-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500"
                          aria-hidden
                        />
                      </div>
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-sm text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <LayoutGrid className="size-4" aria-hidden /> {ws.boardCount}{' '}
                          {ws.boardCount === 1 ? 'board' : 'boards'}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="size-4" aria-hidden /> {ws.memberCount}{' '}
                          {ws.memberCount === 1 ? 'member' : 'members'}
                        </span>
                        {ws.isDemo && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            Demo
                          </span>
                        )}
                        {ws.role === 'OWNER' && (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            Owner
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside>
            <form
              onSubmit={submit}
              noValidate
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="font-semibold">New workspace</h2>
              <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
                You will be its owner and can invite teammates by email.
              </p>
              <Field
                label="Workspace name"
                name="name"
                placeholder="e.g. Product team"
                error={error}
                maxLength={80}
              />
              <Button type="submit" className="mt-4 w-full" loading={create.isPending}>
                {!create.isPending && <Plus className="size-4" aria-hidden />}
                Create workspace
              </Button>
            </form>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
