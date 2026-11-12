import { ClientMessageSchema, type CommandScope, type RemoteConnection, type ServerMessage } from '@codeo/contracts';
import { redactSecrets, type Logger } from '@codeo/shared-utils';
import WebSocket from 'ws';
import type { Runtime } from '../runtime';
import { executeRequest } from '../server/execute';

/*
 * Outbound connection from this runtime to the Codeo gateway (docs/security/remote-access.md §4).
 *
 *   runtime --wss + Bearer runtimeSecret--> gateway /v1/runtimes/<id>/connect
 *
 * Over that socket the runtime plays the *server* role of its own protocol: the gateway says `hello`
 * (client kind `gateway`; its token is a connection marker, never a credential), the runtime answers
 * `welcome`, replays the events the gateway is missing, then streams events and answers the requests
 * the gateway forwards from paired phones. Nothing listens on the developer's machine for this.
 */

/** What a paired phone may do. `workspace:admin` is never granted remotely, whatever the gateway says. */
export const REMOTE_SCOPES: CommandScope[] = ['read', 'session:write', 'approval:decide'];

/* Close codes the gateway uses (apps/gateway/src/relay.ts). */
const CLOSE_REPLACED = 4000;
const CLOSE_UNAUTHORIZED = 4003;

const HEARTBEAT_MS = 30_000;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export interface RelayState {
  connection: Exclude<RemoteConnection, 'disabled'>;
  error: string | null;
}

export interface RelayClientOptions {
  /** `wss://…/v1/runtimes/<id>/connect`. */
  url: string;
  secret: string;
  runtime: Pick<Runtime, 'info' | 'bus' | 'call'>;
  log: Logger;
  onState(state: RelayState): void;
  /** Reconnect backoff bounds (ms). Default 1 s → 30 s. */
  backoff?: { minMs: number; maxMs: number };
}

export class RelayClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private delay: number;
  private readonly minDelay: number;
  private readonly maxDelay: number;

  constructor(private readonly opts: RelayClientOptions) {
    this.minDelay = opts.backoff?.minMs ?? 1_000;
    this.maxDelay = opts.backoff?.maxMs ?? 30_000;
    this.delay = this.minDelay;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.delay = this.minDelay;
    this.connect();
  }

  /** Closes the socket and stops reconnecting. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 2_000);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close(1000, 'runtime stopping');
    });
  }

  private setState(connection: RelayState['connection'], error: string | null = null): void {
    this.opts.onState({ connection, error });
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    this.setState('offline', reason);
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, this.maxDelay);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private connect(): void {
    const { log, runtime } = this.opts;
    this.setState('connecting');
    const socket = new WebSocket(this.opts.url, {
      headers: { authorization: `Bearer ${this.opts.secret}` },
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: 15_000,
    });
    this.socket = socket;

    let greeted = false;
    let unauthorized = false;
    let alive = true;
    /* Live events wait while the missed ones are replayed, so the gateway receives them in order. */
    let replaying = true;
    let sentSeq = 0;
    const queued: Array<{ seq: number; event: unknown }> = [];

    const send = (m: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(redactSecrets(JSON.stringify(m)));
    };
    const sendEvent = (seq: number, event: unknown) => {
      if (seq <= sentSeq) return;
      sentSeq = seq;
      send({ kind: 'event', seq, event: event as never });
    };
    const helloTimer = setTimeout(() => {
      if (!greeted) socket.terminate();
    }, HELLO_TIMEOUT_MS);
    let unsubscribe: (() => void) | null = null;

    socket.on('unexpected-response', (_req, res) => {
      /* The upgrade was refused: 401/403 means the gateway no longer knows this runtime's secret. */
      unauthorized = res.statusCode === 401 || res.statusCode === 403;
      log.warn('gateway refused the relay connection', { status: res.statusCode });
      socket.terminate();
    });
    socket.on('pong', () => {
      alive = true;
    });
    let lastError: string | null = null;
    socket.on('error', (err) => {
      lastError = err.message;
      log.debug('relay socket error', { err: err.message });
    });

    socket.on('message', (data) => {
      let msg;
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(data)));
      } catch {
        log.warn('invalid frame from gateway');
        return;
      }
      if (msg.kind === 'hello') {
        if (greeted) return;
        if (msg.client.kind !== 'gateway') {
          socket.close(CLOSE_UNAUTHORIZED, 'expected the gateway');
          return;
        }
        greeted = true;
        clearTimeout(helloTimer);
        this.delay = this.minDelay;
        unsubscribe = runtime.bus.on('event', ({ seq, event }) => {
          if (replaying) queued.push({ seq, event });
          else sendEvent(seq, event);
        });
        send({ kind: 'welcome', runtime: runtime.info, lastSeq: runtime.bus.lastSeq, scopes: [...REMOTE_SCOPES] });
        void (async () => {
          try {
            if (msg.afterSeq >= 0 && msg.afterSeq < runtime.bus.lastSeq) {
              /* The gateway buffers at most 2 000 events; older ones are not worth sending. */
              let after = Math.max(msg.afterSeq, runtime.bus.lastSeq - 2_000);
              for (;;) {
                const batch = await runtime.bus.replay(after);
                for (const m of batch) sendEvent(m.seq, m.payload);
                const last = batch.at(-1);
                if (!last || batch.length < 500) break;
                after = last.seq;
              }
            } else {
              /* Nothing to backfill: start streaming from now on. */
              sentSeq = runtime.bus.lastSeq;
            }
          } catch (err) {
            log.warn('relay replay failed', { err: err instanceof Error ? err.message : String(err) });
          } finally {
            replaying = false;
            for (const q of queued.splice(0)) sendEvent(q.seq, q.event);
          }
        })();
        this.heartbeat = setInterval(() => {
          if (!alive) {
            socket.terminate();
            return;
          }
          alive = false;
          socket.ping();
        }, HEARTBEAT_MS);
        log.info('relay connected to the gateway', { afterSeq: msg.afterSeq, lastSeq: runtime.bus.lastSeq });
        this.setState('connected');
        return;
      }
      if (!greeted) return;
      if (msg.kind === 'ping') {
        send({ kind: 'pong', t: msg.t });
        return;
      }
      /* The gateway already refused requests outside the device's scopes; the runtime checks again with its own list. */
      void executeRequest(runtime as Runtime, msg, { scopes: REMOTE_SCOPES, clientKind: 'gateway' }, log).then(send);
    });

    socket.on('close', (code, reason) => {
      clearTimeout(helloTimer);
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      unsubscribe?.();
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      if (unauthorized || code === CLOSE_UNAUTHORIZED) {
        this.stopped = true;
        this.setState('unauthorized', 'La passerelle a refusé ce runtime : réactivez l’accès distant pour l’enregistrer à nouveau.');
        return;
      }
      const why =
        code === CLOSE_REPLACED ? 'Remplacé par une autre connexion de ce runtime.'
        : !greeted && lastError ? `Passerelle injoignable : ${lastError}`
        : `Connexion perdue (${code}${reason.length ? ` ${String(reason)}` : ''}).`;
      log.info('relay disconnected', { code });
      this.scheduleRetry(why);
    });
  }
}
