import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { Avatar, IconButton } from './ui';

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className={`mx-auto flex h-14 items-center gap-3 px-4 ${wide ? '' : 'max-w-6xl'}`}>
          <Link to="/app" className="rounded-md" aria-label="FlowSync home">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {user && (
              <>
                <div className="ml-1 hidden items-center gap-2 sm:flex">
                  <Avatar name={user.name} color={user.avatarColor} />
                  <span className="max-w-40 truncate text-sm font-medium">{user.name}</span>
                  {user.isGuest && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      Guest
                    </span>
                  )}
                </div>
                <IconButton
                  label="Sign out"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  <LogOut className="size-5" aria-hidden />
                </IconButton>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
