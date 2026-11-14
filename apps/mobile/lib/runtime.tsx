import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { CommandName, CommandParams, CommandResult, RuntimeEvent, RuntimeInfo } from '@codeo/contracts';
import type { SessionEntry } from '@codeo/domain';
import * as Crypto from 'expo-crypto';
import { CLOSE_RUNTIME_OFFLINE, GatewaySession, RuntimeClient, runtimeIdentityCheck, type ConnectionState } from '@codeo/remote-client';
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
  /** `gateway` once the phone is paired through a gateway, `direct` for a runtime URL + token. */
  mode: 'gateway' | 'direct' | null;
  /** The gateway is reachable but the desktop's runtime is not connected to it (close 4004). */
  runtimeOffline: boolean;
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

let sharedSession: GatewaySession | null = null;

/**
 * One session per paired device for the life of the app. Refresh tokens rotate and a retired one presented
 * again revokes the phone, so two sessions refreshing with the same token (an effect run twice, a remount)
 * must never exist: the session's single-flight refresh only protects callers that share it.
 */
export function gatewaySession(): GatewaySession {
  const credentials = useSettings.getState().gateway;
  if (!credentials) throw new Error('not paired');
  const current = sharedSession?.credentials;
  if (sharedSession && current?.deviceId === credentials.deviceId && current.gatewayUrl === credentials.gatewayUrl) return sharedSession;
  sharedSession = new GatewaySession({
    credentials,
    onCredentials: (next) => useSettings.getState().setGateway(next),
  });
  return sharedSession;
}

/**
 * A client that reaches the runtime through the gateway the phone was paired with. The access token is
 * renewed before it expires, right away when the gateway closes the socket with 4003, and after repeated
 * failed handshakes; a refused refresh (revoked phone) ends in the terminal `unauthorized` state.
 *
 * Before anything is sent, every connection asks the runtime to sign a fresh challenge with its identity
 * key and compares the key with the one from the pairing QR code (or the one accepted on first use). A
 * runtime that cannot prove it ends in the terminal `untrusted` state: the gateway cannot swap it.
 */
function gatewayClient(): RuntimeClient {
  const session = gatewaySession();
  return new RuntimeClient({
    url: session.connectUrl,
    token: (req) => session.accessToken({ force: req.rejected || req.failures >= 2 }),
    bearerHeader: true,
    client: APP_CLIENT,
    verify: runtimeIdentityCheck({
      runtimeId: session.credentials.runtimeId,
      pinnedKey: () => session.credentials.runtimeKey ?? null,
      onFirstUse: (key) => session.pinRuntimeKey(key),
      randomBytes: (length) => Crypto.getRandomBytes(length),
    }),
  });
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const url = useSettings((s) => s.url);
  const token = useSettings((s) => s.token);
  const configured = useSettings(selectConfigured);
  /* Keyed by device, not by the credentials object: a token rotation must not rebuild the connection. */
  const gatewayDevice = useSettings((s) => (s.gateway ? `${s.gateway.deviceId}@${s.gateway.gatewayUrl}` : null));
  const mode = gatewayDevice !== null ? 'gateway' : configured ? 'direct' : null;
  const [runtimeOffline, setRuntimeOffline] = useState(false);
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
      setRuntimeOffline(false);
      return;
    }
    const next = gatewayDevice !== null ? gatewayClient() : new RuntimeClient({ url, token, client: APP_CLIENT });
    const offState = next.on('state', (s) => {
      setState(s);
      if (s === 'connected') {
        setError(null);
        setRuntimeOffline(false);
        void queryClient.invalidateQueries();
      }
    });
    const offDisconnected = next.on('disconnected', ({ code }) => setRuntimeOffline(code === CLOSE_RUNTIME_OFFLINE));
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
      offDisconnected();
      next.close();
      queryClient.clear();
    };
  }, [configured, url, token, gatewayDevice, queryClient]);

  const value = useMemo<RuntimeContextValue>(
    () => ({ client, state, info, error, configured, mode, runtimeOffline }),
    [client, state, info, error, configured, mode, runtimeOffline],
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
