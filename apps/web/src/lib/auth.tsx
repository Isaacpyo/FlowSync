import type { AuthResponse, UserDTO } from '@flowsync/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, setUnauthorizedHandler, tokenStore } from './api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';
import { connectSocket, disconnectSocket } from './socket';
import { toast } from './toast';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    tokenStore.get() ? 'loading' : 'anonymous',
  );
  const [attempt, setAttempt] = useState(0);

  const logout = useCallback(() => {
    tokenStore.set(null);
    disconnectSocket();
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
  }, [queryClient]);

  const expire = useCallback(() => {
    if (!tokenStore.get()) return;
    logout();
    toast('Your session ended. Sign in again to continue.', 'info');
  }, [logout]);

  useEffect(() => setUnauthorizedHandler(expire), [expire]);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    setStatus('loading');
    apiRequest<{ user: UserDTO }>('/api/auth/me')
      .then(({ user }) => {
        if (cancelled) return;
        setUser(user);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) logout();
        else setStatus('offline');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, logout]);

  // Open the realtime connection while signed in.
  useEffect(() => {
    const token = tokenStore.get();
    if (status === 'authenticated' && token) connectSocket(token, expire);
  }, [status, expire]);

  const accept = useCallback((response: AuthResponse) => {
    disconnectSocket();
    tokenStore.set(response.token);
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: async (input) =>
        accept(await apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: input })),
      signup: async (input) =>
        accept(await apiRequest<AuthResponse>('/api/auth/signup', { method: 'POST', body: input })),
      demo: async () =>
        accept(await apiRequest<AuthResponse>('/api/auth/demo', { method: 'POST' })),
      logout,
      retry: () => setAttempt((n) => n + 1),
    }),
    [user, status, accept, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
