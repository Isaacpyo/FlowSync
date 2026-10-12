import { Link } from 'react-router';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo className="text-lg" />
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-slate-500 dark:text-slate-400">This page drifted off somewhere.</p>
      <Link to="/app" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
        Back to your workspaces
      </Link>
    </div>
  );
}
