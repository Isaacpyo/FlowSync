import type { LoginInput, SignupInput, UserDTO } from '@flowsync/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline';

export interface AuthContextValue {
  user: UserDTO | null;
  status: AuthStatus;
  login(input: LoginInput): Promise<UserDTO>;
  signup(input: SignupInput): Promise<UserDTO>;
  demo(): Promise<UserDTO>;
  logout(): void;
  retry(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
