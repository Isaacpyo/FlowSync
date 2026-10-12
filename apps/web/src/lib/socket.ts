import type { ClientToServerEvents, ServerToClientEvents } from '@flowsync/shared';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { API_URL } from '../env';
import { SLOW_MS, useWaking } from './waking';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized';

interface ConnectionState {
  status: ConnectionStatus;
  socketId: string | null;
}

export const useConnection = create<ConnectionState>(() => ({ status: 'idle', socketId: null }));

let socket: AppSocket | null = null;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(status: ConnectionStatus): void {
  useConnection.setState({
    status,
    socketId: status === 'connected' ? (socket?.id ?? null) : null,
  });
  clearTimeout(slowTimer);
  if (status === 'connecting' || status === 'reconnecting') {
    slowTimer = setTimeout(() => useWaking.getState().markSlow('socket'), SLOW_MS);
  } else {
    useWaking.getState().markDone('socket');
  }
}

/** One shared connection per signed-in session. */
export function connectSocket(token: string, onUnauthorized: () => void): AppSocket {
  if (socket) return socket;
  const s: AppSocket = io(API_URL, {
    auth: { token },
    reconnectionDelayMax: 5_000,
  });
  socket = s;
  setStatus('connecting');
  s.on('connect', () => setStatus('connected'));
  s.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') setStatus('idle');
    else setStatus('reconnecting');
  });
  s.on('connect_error', (error) => {
    if (error.message === 'UNAUTHORIZED') {
      setStatus('unauthorized');
      onUnauthorized();
    } else {
      setStatus(s.active ? 'reconnecting' : 'idle');
    }
  });
  return s;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  setStatus('idle');
}
