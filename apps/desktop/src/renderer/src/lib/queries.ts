import type { AgentSession, SessionEntry } from '@codeo/domain';
import type { RuntimeEvent } from '@codeo/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { invoke } from './api';

export const keys = {
  runtime: ['runtime'] as const,
  providers: ['providers'] as const,
  workspaces: ['workspaces'] as const,
  tasks: (workspaceId?: string | null) => ['tasks', workspaceId ?? 'all'] as const,
  sessions: (workspaceId?: string | null) => ['sessions', workspaceId ?? 'all'] as const,
  session: (id: string) => ['session', id] as const,
  approvals: ['approvals', 'pending'] as const,
  worktrees: (taskId: string) => ['worktrees', taskId] as const,
  home: (workspaceId?: string | null) => ['home', workspaceId ?? 'default'] as const,
};

export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: () => invoke('workspaces.list', {}) });
export const useProviders = () => useQuery({ queryKey: keys.providers, queryFn: () => invoke('providers.list', {}), staleTime: 60_000 });
export const useTasks = (workspaceId: string | null) =>
  useQuery({ queryKey: keys.tasks(workspaceId), queryFn: () => invoke('tasks.list', workspaceId ? { workspaceId } : {}) });
export const useSessions = (workspaceId: string | null) =>
  useQuery({ queryKey: keys.sessions(workspaceId), queryFn: () => invoke('sessions.list', workspaceId ? { workspaceId } : {}) });
export const useSession = (id: string | null) =>
  useQuery({ queryKey: keys.session(id ?? ''), queryFn: () => invoke('sessions.get', { sessionId: id! }), enabled: Boolean(id) });
export const useWorktrees = (taskId: string | null) =>
  useQuery({ queryKey: keys.worktrees(taskId ?? ''), queryFn: () => invoke('worktrees.list', { taskId: taskId! }), enabled: Boolean(taskId) });
export const usePendingApprovals = () => useQuery({ queryKey: keys.approvals, queryFn: () => invoke('approvals.list', { status: 'pending' }) });
export const useHome = (workspaceId: string | null) =>
  useQuery({ queryKey: keys.home(workspaceId), queryFn: () => invoke('home.summary', workspaceId ? { workspaceId } : {}) });

export function useResolveApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { approvalId: string; decision: 'approve' | 'reject' }) => invoke('approvals.resolve', p),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

type SessionDetail = { session: AgentSession; entries: SessionEntry[] };

/** Applies runtime events to the caches: patch when cheap, invalidate otherwise. */
export function applyEvent(qc: QueryClient, event: RuntimeEvent): void {
  switch (event.type) {
    case 'ProvidersChanged':
      qc.setQueryData(keys.providers, event.providers);
      return;
    case 'WorkspaceCreated':
    case 'WorkspaceUpdated':
    case 'WorkspaceDeleted':
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      void qc.invalidateQueries({ queryKey: ['home'] });
      return;
    case 'TaskCreated':
    case 'TaskUpdated':
    case 'TaskCompleted':
    case 'TaskFailed':
    case 'TaskProgressChanged':
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      /* Agents finishing a step change the worktrees' dirty state. */
      if (event.type === 'TaskUpdated') void qc.invalidateQueries({ queryKey: ['worktrees', event.task.id] });
      return;
    case 'WorktreeCreated':
    case 'WorktreeRemoved':
      void qc.invalidateQueries({ queryKey: ['worktrees'] });
      return;
    case 'SessionCreated':
    case 'SessionUpdated':
      qc.setQueryData<SessionDetail>(keys.session(event.session.id), (prev) => (prev ? { ...prev, session: event.session } : prev));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      return;
    case 'SessionEntryAppended':
      qc.setQueryData<SessionDetail>(keys.session(event.sessionId), (prev) => {
        if (!prev) return prev;
        if (prev.entries.some((e) => e.id === event.entry.id)) return prev;
        return { ...prev, entries: [...prev.entries, event.entry] };
      });
      return;
    case 'SessionEntryUpdated':
      qc.setQueryData<SessionDetail>(keys.session(event.sessionId), (prev) => {
        if (!prev) return prev;
        const idx = prev.entries.findIndex((e) => e.id === event.entry.id);
        if (idx < 0) return { ...prev, entries: [...prev.entries, event.entry] };
        const entries = prev.entries.slice();
        entries[idx] = event.entry;
        return { ...prev, entries };
      });
      return;
    case 'ApprovalRequested':
    case 'ApprovalResolved':
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      return;
    case 'RuntimeReady':
      void qc.invalidateQueries();
      return;
  }
}

export function useRuntimeEvents() {
  const qc = useQueryClient();
  useEffect(() => window.codeo.onEvent(({ event }) => applyEvent(qc, event)), [qc]);
}
