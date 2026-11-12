import {
  PROTOCOL_VERSION,
  RuntimeError,
  ServerMessageSchema,
  type ClientMessage,
  type CommandName,
  type CommandParams,
  type CommandResult,
  type RuntimeEvent,
  type RuntimeInfo,
  type ServerMessage,
} from '@codeo/contracts';
/* Subpaths, not the barrel: the barrel pulls `node:crypto` (ids), which React Native cannot bundle. */
import { Deferred } from '@codeo/shared-utils/deferred';
import { TypedEmitter } from '@codeo/shared-utils/emitter';

/** Minimal WebSocket surface shared by browsers, React Native and the `ws` package. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
/** `init.headers` carries `Authorization` when `bearerHeader` is on (React Native and `ws` support it). */
export type WebSocketFactory = (url: string, init: { headers: Record<string, string> }) => WebSocketLike;

/**
 * `unauthorized` is terminal: the credentials were refused for good (revoked phone, refresh token gone).
 * Nothing reconnects until a new client is built with new credentials.
 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' | 'closed';

/** Context handed to a token provider before each connection attempt. */
export interface TokenRequest {
  /** Attempts in a row that ended before `welcome`. */
  failures: number;
  /** The previous socket was closed with 4003 (credentials refused): the token should be renewed. */
  rejected: boolean;
}

/** A token provider that throws an error with `fatal === true` moves the client to `unauthorized`. */
export type TokenProvider = string | ((request: TokenRequest) => string | Promise<string>);

/** Close codes the gateway uses towards devices (`apps/gateway/src/relay.ts`). */
export const CLOSE_UNAUTHORIZED = 4003;
export const CLOSE_RUNTIME_OFFLINE = 4004;

export interface RuntimeClientOptions {
  url: string;
  token: TokenProvider;
  client: { name: string; version: string; kind: 'desktop' | 'mobile' | 'gateway' | 'cli' | 'test' };
  /** Also send the token as `Authorization: Bearer` on the upgrade request (required by the gateway). */
  bearerHeader?: boolean;
  createWebSocket?: WebSocketFactory;
  requestTimeoutMs?: number;
  reconnect?: boolean;
  /** Replay the whole event log on first connect (default: only replay after a reconnect). */
  replayFromStart?: boolean;
}

interface ClientEvents extends Record<string, unknown> {
  state: ConnectionState;
  event: { seq: number; event: RuntimeEvent };
  welcome: { runtime: RuntimeInfo; lastSeq: number; scopes: string[] };
  /** The socket closed; `code`/`reason` as sent by the peer when known (4004 = runtime offline behind a gateway). */
  disconnected: { code: number | null; reason: string };
  error: Error;
}

function isFatal(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'fatal' in err && (err as { fatal: unknown }).fatal === true;
}

function closeInfo(ev: unknown): { code: number | null; reason: string } {
  if (typeof ev !== 'object' || ev === null) return { code: null, reason: '' };
  const { code, reason } = ev as { code?: unknown; reason?: unknown };
  return { code: typeof code === 'number' ? code : null, reason: typeof reason === 'string' ? reason : '' };
}

/* Browsers ignore the third argument; React Native reads `headers` from it. */
type HeaderWebSocketCtor = new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocketLike;
const defaultFactory: WebSocketFactory = (url, init) => new (WebSocket as unknown as HeaderWebSocketCtor)(url, undefined, init);

/**
 * Typed client for the Codeo runtime protocol. Tracks the last event sequence so a
 * reconnect replays what was missed instead of re-downloading state.
 */
export class RuntimeClient extends TypedEmitter<ClientEvents> {
  private ws: WebSocketLike | null = null;
  private pending = new Map<string, { d: Deferred<unknown>; timer: ReturnType<typeof setTimeout> }>();
  private counter = 0;
  private _state: ConnectionState = 'idle';
  private _lastSeq = 0;
  private reconnectDelay = 500;
  private hello = new Deferred<void>();
  private closedByUser = false;
  private failures = 0;
  private rejected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  runtime: RuntimeInfo | null = null;
  scopes: string[] = [];

  constructor(private readonly opts: RuntimeClientOptions) {
    super();
  }

  get state(): ConnectionState {
    return this._state;
  }
  get lastSeq(): number {
    return this._lastSeq;
  }

  private setState(s: ConnectionState) {
    this._state = s;
    this.emit('state', s);
  }

  connect(): Promise<void> {
    this.closedByUser = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setState(this._state === 'idle' ? 'connecting' : 'reconnecting');
    this.hello = new Deferred<void>();
    const hello = this.hello;
    void this.open(hello);
    return hello.promise;
  }

  private async open(hello: Deferred<void>): Promise<void> {
    let token: string;
    try {
      const provider = this.opts.token;
      token = typeof provider === 'string' ? provider : await provider({ failures: this.failures, rejected: this.rejected });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      if (!hello.settled) hello.reject(error);
      if (isFatal(err)) {
        this.setState('unauthorized');
        return;
      }
      this.failures++;
      this.scheduleReconnect();
      return;
    }
    if (this.closedByUser) {
      if (!hello.settled) hello.reject(new RuntimeError('INTERNAL', 'connection closed'));
      return;
    }
    this.rejected = false;
    const factory = this.opts.createWebSocket ?? defaultFactory;
    const ws = factory(this.opts.url, { headers: this.opts.bearerHeader ? { Authorization: `Bearer ${token}` } : {} });
    this.ws = ws;
    ws.onopen = () => {
      const msg: ClientMessage = {
        kind: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token,
        client: this.opts.client,
        afterSeq: this._lastSeq > 0 || this.opts.replayFromStart ? this._lastSeq : -1,
      };
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      const info = closeInfo(ev);
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.d.reject(new RuntimeError('INTERNAL', 'connection closed'));
        this.pending.delete(id);
      }
      if (!hello.settled) {
        this.failures++;
        hello.reject(new RuntimeError('INTERNAL', 'connection closed before welcome'));
      }
      if (info.code === CLOSE_UNAUTHORIZED) this.rejected = true;
      this.emit('disconnected', info);
      if (this.closedByUser || this.opts.reconnect === false) {
        if (this._state !== 'unauthorized') this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.opts.reconnect === false) {
      this.setState('closed');
      return;
    }
    this.setState('reconnecting');
    /* A refused token is renewed right away; anything else backs off. */
    const delay = this.rejected ? 0 : this.reconnectDelay;
    if (!this.rejected) this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect().catch(() => undefined);
    }, delay);
  }

  private handle(raw: string) {
    let msg: ServerMessage;
    try {
      msg = ServerMessageSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return;
    }
    switch (msg.kind) {
      case 'welcome':
        this.runtime = msg.runtime;
        this.scopes = msg.scopes;
        this.reconnectDelay = 500;
        this.failures = 0;
        this.setState('connected');
        this.emit('welcome', { runtime: msg.runtime, lastSeq: msg.lastSeq, scopes: msg.scopes });
        this.hello.resolve();
        return;
      case 'response': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.d.resolve(msg.result);
        else p.d.reject(new RuntimeError(msg.error?.code ?? 'INTERNAL', msg.error?.message ?? 'Erreur inconnue', msg.error?.details));
        return;
      }
      case 'event':
        if (msg.seq > this._lastSeq) this._lastSeq = msg.seq;
        this.emit('event', { seq: msg.seq, event: msg.event });
        return;
      case 'error':
        this.emit('error', new Error(msg.message));
        return;
      case 'pong':
        return;
    }
  }

  async request<C extends CommandName>(command: C, params: CommandParams<C>): Promise<CommandResult<C>> {
    if (!this.ws || this._state !== 'connected') throw new RuntimeError('INTERNAL', 'runtime not connected');
    const id = `${Date.now().toString(36)}-${++this.counter}`;
    const d = new Deferred<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      d.reject(new RuntimeError('INTERNAL', `request ${command} timed out`));
    }, this.opts.requestTimeoutMs ?? 60_000);
    this.pending.set(id, { d, timer });
    const msg: ClientMessage = { kind: 'request', id, command, params };
    this.ws.send(JSON.stringify(msg));
    return d.promise as Promise<CommandResult<C>>;
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }
}
