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
import { Deferred, TypedEmitter } from '@codeo/shared-utils';

/** Minimal WebSocket surface shared by browsers, React Native and the `ws` package. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface RuntimeClientOptions {
  url: string;
  token: string;
  client: { name: string; version: string; kind: 'desktop' | 'mobile' | 'gateway' | 'cli' | 'test' };
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
  error: Error;
}

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
    this.setState(this._state === 'idle' ? 'connecting' : 'reconnecting');
    const factory = this.opts.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const ws = factory(this.opts.url);
    this.ws = ws;
    this.hello = new Deferred<void>();
    ws.onopen = () => {
      const msg: ClientMessage = {
        kind: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: this.opts.token,
        client: this.opts.client,
        afterSeq: this._lastSeq > 0 || this.opts.replayFromStart ? this._lastSeq : -1,
      };
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      this.ws = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.d.reject(new RuntimeError('INTERNAL', 'connection closed'));
        this.pending.delete(id);
      }
      if (!this.hello.settled) this.hello.reject(new RuntimeError('INTERNAL', 'connection closed before welcome'));
      if (this.closedByUser || this.opts.reconnect === false) {
        this.setState('closed');
        return;
      }
      this.setState('reconnecting');
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
      setTimeout(() => {
        if (!this.closedByUser) this.connect().catch(() => undefined);
      }, delay);
    };
    return this.hello.promise;
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
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }
}
