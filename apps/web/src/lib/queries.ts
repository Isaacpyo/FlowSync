import type {
  BoardSummaryDTO,
  CreateBoardInput,
  MemberDTO,
  WorkspaceDetailDTO,
  WorkspaceDTO,
} from '@flowsync/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';

export const useWorkspaces = () =>
  useQuery({
    queryKey: ['workspaces'],
    queryFn: () => apiRequest<WorkspaceDTO[]>('/api/workspaces'),
  });

export const useWorkspace = (workspaceId: string) =>
  useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => apiRequest<WorkspaceDetailDTO>(`/api/workspaces/${workspaceId}`),
  });

export function useCreateWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest<WorkspaceDTO>('/api/workspaces', { method: 'POST', body: { name } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useCreateBoard(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInput) =>
      apiRequest<BoardSummaryDTO>(`/api/workspaces/${workspaceId}/boards`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      void client.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useInviteMember(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiRequest<MemberDTO>(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: { email },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
  });
}

/** After "Try the demo": the first board of the demo workspace, if there is one. */
export async function findDemoBoard(): Promise<string | null> {
  const workspaces = await apiRequest<WorkspaceDTO[]>('/api/workspaces');
  const demo = workspaces.find((w) => w.isDemo);
  if (!demo) return null;
  const detail = await apiRequest<WorkspaceDetailDTO>(`/api/workspaces/${demo.id}`);
  return detail.boards[0]?.id ?? null;
}
