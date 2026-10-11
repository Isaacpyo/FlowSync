import { createBoardSchema, fieldErrors, inviteMemberSchema } from '@flowsync/shared';
import { ChevronRight, KanbanSquare, Plus, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { Avatar, Button, EmptyState, ErrorState, Field, PageLoader } from '../components/ui';
import { ApiError } from '../lib/api';
import { useCreateBoard, useInviteMember, useWorkspace } from '../lib/queries';
import { timeAgo } from '../lib/time';
import { toast } from '../lib/toast';

export function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const query = useWorkspace(workspaceId);
  const [creating, setCreating] = useState(false);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        {query.isPending ? (
          <PageLoader label="Loading workspace" />
        ) : query.isError ? (
          <ErrorState
            title={
              query.error instanceof ApiError && query.error.status === 404
                ? 'Workspace not found'
                : undefined
            }
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <nav aria-label="Breadcrumb" className="text-sm text-slate-500 dark:text-slate-400">
              <Link
                to="/app"
                className="hover:text-slate-900 hover:underline dark:hover:text-white"
              >
                Workspaces
              </Link>
              <ChevronRight className="mx-1 inline size-4" aria-hidden />
              <span aria-current="page">{query.data.workspace.name}</span>
            </nav>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-bold tracking-tight">{query.data.workspace.name}</h1>
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                New board
              </Button>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
              <section aria-labelledby="boards-heading">
                <h2
                  id="boards-heading"
                  className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500"
                >
                  Boards
                </h2>
                {query.data.boards.length === 0 ? (
                  <EmptyState
                    icon={<KanbanSquare className="size-6" aria-hidden />}
                    title="No boards yet"
                    description="Boards hold your tasks. New boards start with To do, In progress and Done."
                    action={
                      <Button onClick={() => setCreating(true)}>Create the first board</Button>
                    }
                  />
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {query.data.boards.map((board) => (
                      <li key={board.id}>
                        <Link
                          to={`/b/${board.id}`}
                          className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/50"
                        >
                          <span className="flex items-center gap-2 font-semibold">
                            <KanbanSquare className="size-4 text-brand-500" aria-hidden />
                            {board.name}
                          </span>
                          {board.description && (
                            <span className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                              {board.description}
                            </span>
                          )}
                          <span className="mt-auto pt-4 text-xs text-slate-500 dark:text-slate-400">
                            {board.taskCount} {board.taskCount === 1 ? 'task' : 'tasks'} · updated{' '}
                            {timeAgo(board.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <MembersPanel
                workspaceId={workspaceId}
                isOwner={query.data.workspace.role === 'OWNER'}
                isDemo={query.data.workspace.isDemo}
                members={query.data.members}
                memberCount={query.data.workspace.memberCount}
              />
            </div>
          </>
        )}
      </div>
      <CreateBoardDialog
        workspaceId={workspaceId}
        open={creating}
        onClose={() => setCreating(false)}
      />
    </AppShell>
  );
}

function MembersPanel({
  workspaceId,
  isOwner,
  isDemo,
  members,
  memberCount,
}: {
  workspaceId: string;
  isOwner: boolean;
  isDemo: boolean;
  members: { id: string; name: string; email: string; avatarColor: string; role: string }[];
  memberCount: number;
}) {
  const invite = useInviteMember(workspaceId);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = inviteMemberSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).email);
      return;
    }
    setError(undefined);
    try {
      const member = await invite.mutateAsync(parsed.data.email);
      form.reset();
      toast(`${member.name} joined the workspace`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not invite');
    }
  }

  const hidden = memberCount - members.length;

  return (
    <aside
      aria-labelledby="members-heading"
      className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 id="members-heading" className="font-semibold">
        Members <span className="font-normal text-slate-500">({memberCount})</span>
      </h2>
      <ul className="mt-3 space-y-3">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3">
            <Avatar name={m.name} color={m.avatarColor} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{m.email}</p>
            </div>
            {m.role === 'OWNER' && (
              <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Owner</span>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          + {hidden} {isDemo ? 'demo guests' : 'more'}
        </p>
      )}
      {isOwner ? (
        <form
          onSubmit={submit}
          noValidate
          className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
          <Field
            label="Invite by email"
            name="email"
            type="email"
            placeholder="teammate@company.com"
            error={error}
            hint="They need a FlowSync account first."
          />
          <Button
            type="submit"
            variant="secondary"
            className="mt-3 w-full"
            loading={invite.isPending}
          >
            {!invite.isPending && <UserPlus className="size-4" aria-hidden />}
            Invite
          </Button>
        </form>
      ) : (
        <p className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Only the workspace owner can invite people.
        </p>
      )}
    </aside>
  );
}

function CreateBoardDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const create = useCreateBoard(workspaceId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createBoardSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      const board = await create.mutateAsync(parsed.data);
      onClose();
      navigate(`/b/${board.id}`);
    } catch (e) {
      setErrors({ _: e instanceof Error ? e.message : 'Could not create the board' });
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New board">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Name"
          name="name"
          placeholder="e.g. Q4 launch"
          error={errors.name}
          autoFocus
          maxLength={80}
        />
        <Field
          label="Description (optional)"
          name="description"
          error={errors.description}
          maxLength={500}
        />
        {errors._ && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errors._}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create board
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
