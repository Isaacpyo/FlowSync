import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from './components/Toaster';
import { ErrorState, PageLoader } from './components/ui';
import { WakingBanner } from './components/WakingBanner';
import { useAuth } from './lib/auth-context';
import { useThemeEffect } from './lib/theme';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Signed-in pages (and the drag-and-drop code) load on demand.
const WorkspacesPage = lazy(() =>
  import('./pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, retry } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader label="Signing you in" />;
  if (status === 'offline') {
    return (
      <ErrorState
        title="Can't reach FlowSync"
        message="The server is not responding. It may still be waking up."
        onRetry={retry}
      />
    );
  }
  if (status === 'anonymous')
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export function App() {
  useThemeEffect();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow dark:focus:bg-slate-900"
      >
        Skip to content
      </a>
      <WakingBanner />
      <div id="main">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <WorkspacesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/w/:workspaceId"
            element={
              <RequireAuth>
                <WorkspacePage />
              </RequireAuth>
            }
          />
          <Route
            path="/b/:boardId"
            element={
              <RequireAuth>
                <BoardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
      <Toaster />
    </>
  );
}
