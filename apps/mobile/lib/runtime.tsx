import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { CommandName, CommandParams, CommandResult, RuntimeEvent, RuntimeInfo } from '@codeo/contracts';
import type { SessionEntry } from '@codeo/domain';
import { RuntimeClient, type ConnectionState } from '@codeo/remote-client';
import { selectConfigured, useSettings } from './settings';

export const APP_CLIENT = { name: 'codeo-remote', version: '0.1.0', kind: 'mobile' } as const;

export interface RuntimeContextValue {
  /** Null until a URL and a token are stored. */
  client: RuntimeClient | null;
  state: ConnectionState;
  /** From the `welcome` frame. */
  info: RuntimeInfo | null;
  /** Last transport / protocol error, for the settings screen. */
  error: string | null;
  configured: boolean;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

/** Query key convention: `[command, params]`, so `invalidateQueries({ queryKey: [command] })` hits every variant. */
export const queryKey = <C extends CommandName>(command: C, params: CommandParams<C>) => [command, params] as const;

type SessionGet = CommandResult<'sessions.get'>;

function patchSessionEntry(queryClient: QueryClient, sessionId: string, entry: SessionEntry): void {
  queryClient.setQueriesData<SessionGet>({ queryKey: ['sessions.get', { sessionId }] }, (old) => {
    if (!old) return old;
    const idx = old.entries.findIndex((e) => e.id === entry.id);
    const entries = idx === -1 ? [...old.entries, entry] : old.entries.map((e) => (e.id === entry.id ? entry : e));
    entries.sort((a, b) => a.seq - b.seq);
    return { ...old, entries };
  });
}

/** Keeps TanStack caches in step with runtime events: patch what we can, invalidate the rest. */
function bridgeEvent(queryClient: QueryClient, event: RuntimeEvent): void {
  const invalidate = (...commands: CommandName[]) => {
    for (const c of commands) void queryClient.invalidateQueries({ queryKey: [c] });
  };
  switch (event.type) {
    case 'SessionEntryAppended':
    case 'SessionEntryUpdated':
      patchSessionEntry(queryClient, event.sessionId, event.entry);
      return;
    case 'SessionCreated':
    case 'SessionUpdated':
      queryClient.setQueriesData<SessionGet>({ queryKey: ['sessions.get', { sessionId: event.session.id }] }, (old) =>
        old ? { ...old, session: event.session } : old,
      );
      invalidate('sessions.list', 'home.summary');
      return;
    case 'TaskCreated':
    case 'TaskUpdated':
    case 'TaskProgressChanged':
    case 'TaskCompleted':
    case 'TaskFailed':
      invalidate('tasks.list', 'tasks.get', 'home.summary');
      return;
    case 'ApprovalRequested':
    case 'ApprovalResolved':
      invalidate('approvals.list', 'home.summary', 'sessions.list');
      return;
    case 'WorkspaceCreated':
    case 'WorkspaceUpdated':
    case 'WorkspaceDeleted':
      invalidate('workspaces.list', 'home.summary');
      return;
    case 'ProvidersChanged':
      invalidate('providers.list');
      return;
    case 'RuntimeReady':
      invalidate('runtime.info');
      return;
  }
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const url = useSettings((s) => s.url);
  const token = useSettings((s) => s.token);
  const configured = useSettings(selectConfigured);
  const [client, setClient] = useState<RuntimeClient | null>(null);
  const [state, setState] = useState<ConnectionState>('idle');
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setClient(null);
      setState('idle');
      setInfo(null);
      setError(null);
      return;
    }
    const next = new RuntimeClient({ url, token, client: APP_CLIENT });
    const offState = next.on('state', (s) => {
      setState(s);
      if (s === 'connected') {
        setError(null);
        void queryClient.invalidateQueries();
      }
    });
    const offWelcome = next.on('welcome', ({ runtime }) => setInfo(runtime));
    const offError = next.on('error', (err) => setError(err.message));
    const offEvent = next.on('event', ({ event }) => bridgeEvent(queryClient, event));
    setClient(next);
    setError(null);
    next.connect().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      offState();
      offWelcome();
      offError();
      offEvent();
      next.close();
      queryClient.clear();
    };
  }, [configured, url, token, queryClient]);

  const value = useMemo<RuntimeContextValue>(
    () => ({ client, state, info, error, configured }),
    [client, state, info, error, configured],
  );
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime must be used inside <RuntimeProvider>');
  return value;
}

export interface UseCommandOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

/** A runtime command as a TanStack query; disabled until the client is connected. */
export function useCommand<C extends CommandName>(
  command: C,
  params: CommandParams<C>,
  options: UseCommandOptions = {},
): UseQueryResult<CommandResult<C>, Error> {
  const { client, state } = useRuntime();
  const ready = client !== null && state === 'connected';
  return useQuery<CommandResult<C>, Error>({
    queryKey: queryKey(command, params),
    queryFn: () => {
      if (!client) throw new Error('runtime not connected');
      return client.request(command, params);
    },
    enabled: ready && (options.enabled ?? true),
    ...(options.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

/** Returns a connected client or throws — for mutations. */
export function useConnectedClient(): () => RuntimeClient {
  const { client, state } = useRuntime();
  return () => {
    if (!client || state !== 'connected') throw new Error('runtime not connected');
    return client;
  };
}

/** Ticks every `intervalMs`, for countdowns and relative times. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
