import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  ServerMessageSchema,
  commands,
  type ClientMessage,
  type CommandScope,
  type RuntimeEvent,
  type ServerMessage,
} from '@codeo/contracts';
import { newId, redactSecrets, type Logger } from '@codeo/shared-utils';
import type { Auditor } from './audit';
import type { AuthService, DeviceAuth } from './auth';
import { iso, type Clock } from './clock';
import { errorBody, toGatewayError } from './errors';
import { SeqRingBuffer } from './ring-buffer';
import type { GatewayStore, RuntimeRecord } from './store';

/*
 * WebSocket relay.
 *
 *   runtime  --(outbound, Bearer runtimeSecret)-->  GET /v1/runtimes/:id/connect
 *   device   --(Bearer accessToken)------------->  GET /v1/devices/connect
 *
 * The gateway is a *pipe with a bouncer*: frames from the runtime are parsed as `ServerMessage`,
 * frames from devices as `ClientMessage`, and the gateway never executes commands itself.
 *
 * Protocol between gateway and runtime (the runtime side is the relay client planned for apps/runtime):
 *   1. On connect the gateway sends a standard `hello` (client kind `gateway`, `afterSeq` = last event
 *      sequence it still holds, or -1 when it holds none). The `token` field is a non-secret connection
 *      marker: the runtime authenticated the gateway through TLS when it dialled out; the gateway
 *      authenticated the runtime through the bearer secret on the upgrade request.
 *   2. The runtime answers with `welcome` (its RuntimeInfo and lastSeq) and replays events > afterSeq.
 *   3. Requests from devices are forwarded with the id rewritten to `<deviceConnId>:<originalId>` so the
 *      matching `response` is routed back to exactly one device; events are broadcast to every device.
 *
 * Replay: the gateway keeps the last RELAY_RING_CAPACITY events per runtime. A device reconnecting with
 * `afterSeq` older than the ring receives an `error` frame mentioning `replay-gap` and must refresh its
 * state via regular queries (the RuntimeClient surfaces it as an `error` event).
 */

export const RELAY_RING_CAPACITY = 2000;
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/* Close codes (4000-4999 are application-defined). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_HELLO_TIMEOUT = 4001;
export const CLOSE_UNAUTHORIZED = 4003;
export const CLOSE_RUNTIME_OFFLINE = 4004;

type WelcomeMessage = Extract<ServerMessage, { kind: 'welcome' }>;

/*
 * `ServerMessageSchema` is a discriminated union on `kind` with two `response` members (ok / error).
 * zod 4.6 rejects duplicate discriminator values at parse time ("Duplicate discriminator value"), so the
 * relay parses runtime frames with a plain union over the same members (identical output type). Once
 * `@codeo/contracts` merges the two response variants this can go back to `ServerMessageSchema`.
 */
const RuntimeFrameSchema = z.union(ServerMessageSchema.options);

interface DeviceConn {
  connId: string;
  deviceId: string;
  runtimeId: string;
  scopes: CommandScope[];
  socket: WebSocket;
  ip: string;
  helloDone: boolean;
  /** Highest event seq delivered to this connection; events with seq <= lastSeq are dropped. */
  lastSeq: number;
  alive: boolean;
}

interface RuntimeState {
  runtimeId: string;
  connId: string | null;
  socket: WebSocket | null;
  welcome: WelcomeMessage | null;
  ring: SeqRingBuffer<RuntimeEvent>;
  devices: Map<string, DeviceConn>;
  alive: boolean;
}

export interface RelayOptions {
  store: GatewayStore;
  auth: AuthService;
  audit: Auditor;
  clock: Clock;
  log: Logger;
  version: string;
}

export interface Relay {
  plugin: FastifyPluginAsync;
  isRuntimeConnected(runtimeId: string): boolean;
  isDeviceConnected(deviceId: string): boolean;
  connectedRuntimeCount(): number;
  /** Closes every socket of a device (used on revocation). */
  disconnectDevice(deviceId: string, reason: string): void;
  close(): void;
}

function sendToDevice(socket: WebSocket, msg: ServerMessage): void {
  /* Everything leaving towards a phone passes through secret redaction, like the runtime's own server. */
  if (socket.readyState === socket.OPEN) socket.send(redactSecrets(JSON.stringify(msg)));
}

function sendToRuntime(socket: WebSocket, msg: ClientMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, reason);
}

export function createRelay(opts: RelayOptions): Relay {
  const { store, auth, audit, clock } = opts;
  const log = opts.log.child('relay');
  const runtimes = new Map<string, RuntimeState>();

  const getState = (runtimeId: string): RuntimeState => {
    let s = runtimes.get(runtimeId);
    if (!s) {
      s = { runtimeId, connId: null, socket: null, welcome: null, ring: new SeqRingBuffer<RuntimeEvent>(RELAY_RING_CAPACITY), devices: new Map(), alive: false };
      runtimes.set(runtimeId, s);
    }
    return s;
  };

  /* ---------------------------------------------------------------- */
  /* Runtime side                                                       */
  /* ---------------------------------------------------------------- */

  function handleRuntimeFrame(state: RuntimeState, raw: string): void {
    let msg: ServerMessage;
    try {
      msg = RuntimeFrameSchema.parse(JSON.parse(raw));
    } catch {
      log.warn('invalid frame from runtime', { runtimeId: state.runtimeId });
      return;
    }
    switch (msg.kind) {
      case 'welcome':
        state.welcome = msg;
        log.info('runtime welcome', { runtimeId: state.runtimeId, lastSeq: msg.lastSeq, version: msg.runtime.version });
        return;
      case 'event': {
        if (!state.ring.push(msg.seq, msg.event)) {
          log.debug('dropped duplicate or out-of-order event', { runtimeId: state.runtimeId, seq: msg.seq });
          return;
        }
        for (const dev of state.devices.values()) {
          if (msg.seq <= dev.lastSeq) continue;
          dev.lastSeq = msg.seq;
          sendToDevice(dev.socket, msg);
        }
        return;
      }
      case 'response': {
        const sep = msg.id.indexOf(':');
        if (sep <= 0) return;
        const dev = state.devices.get(msg.id.slice(0, sep));
        if (!dev) return; /* device went away; drop */
        const id = msg.id.slice(sep + 1);
        sendToDevice(dev.socket, msg.ok ? { kind: 'response', id, ok: true, result: msg.result } : { kind: 'response', id, ok: false, error: msg.error });
        return;
      }
      case 'pong':
        return;
      case 'error':
        log.warn('runtime reported error', { runtimeId: state.runtimeId, message: msg.message });
        return;
    }
  }

  function attachRuntime(socket: WebSocket, runtime: RuntimeRecord, ip: string): void {
    const state = getState(runtime.runtimeId);
    const connId = newId('rconn');
    const actor = `runtime:${runtime.runtimeId}`;

    if (state.socket) {
      const old = state.socket;
      state.socket = null;
      closeSocket(old, CLOSE_REPLACED, 'replaced by a newer runtime connection');
    }
    state.socket = socket;
    state.connId = connId;
    state.welcome = null;
    state.alive = true;

    void store.runtimes.touch(runtime.runtimeId, iso(clock()));
    void audit({ actor, action: 'relay.runtime.connect', target: connId, ok: true, detail: `ip=${ip}` });
    log.info('runtime connected', { runtimeId: runtime.runtimeId, connId, devices: state.devices.size });

    sendToRuntime(socket, {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      token: `relay-session:${connId}`,
      client: { name: 'codeo-gateway', version: opts.version, kind: 'gateway' },
      afterSeq: state.ring.lastSeq > 0 ? state.ring.lastSeq : -1,
    });

    socket.on('pong', () => {
      state.alive = true;
    });
    socket.on('message', (data) => handleRuntimeFrame(state, String(data)));
    socket.on('error', (err) => log.warn('runtime socket error', { runtimeId: runtime.runtimeId, err: err.message }));
    socket.on('close', (code, reason) => {
      if (state.connId !== connId) return; /* already replaced */
      state.socket = null;
      state.connId = null;
      state.welcome = null;
      void audit({ actor, action: 'relay.runtime.disconnect', target: connId, ok: true, detail: `code=${code} reason=${String(reason)}` });
      log.info('runtime disconnected', { runtimeId: runtime.runtimeId, connId, code });
      for (const dev of state.devices.values()) sendToDevice(dev.socket, { kind: 'error', message: 'runtime offline' });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Device side                                                        */
  /* ---------------------------------------------------------------- */

  async function handleDeviceHello(conn: DeviceConn, msg: Extract<ClientMessage, { kind: 'hello' }>): Promise<void> {
    if (conn.helloDone) return;
    const actor = `device:${conn.deviceId}`;
    /* The hello token is verified too (RuntimeClient sends the same access token in both places). */
    let verified: DeviceAuth;
    try {
      verified = await auth.verifyDeviceToken(msg.token);
    } catch (err) {
      const e = toGatewayError(err);
      await audit({ actor, action: 'relay.device.connect', target: conn.connId, ok: false, detail: `hello rejected: ${e.message}` });
      sendToDevice(conn.socket, { kind: 'error', message: e.message });
      closeSocket(conn.socket, CLOSE_UNAUTHORIZED, 'unauthorized');
      return;
    }
    if (verified.device.deviceId !== conn.deviceId) {
      await audit({ actor, action: 'relay.device.connect', target: conn.connId, ok: false, detail: 'hello token belongs to another device' });
      closeSocket(conn.socket, CLOSE_UNAUTHORIZED, 'unauthorized');
      return;
    }
    const state = getState(conn.runtimeId);
    if (!state.socket || !state.welcome) {
      await audit({ actor, action: 'relay.device.connect', target: conn.connId, ok: false, detail: 'runtime offline' });
      sendToDevice(conn.socket, { kind: 'error', message: 'runtime offline' });
      closeSocket(conn.socket, CLOSE_RUNTIME_OFFLINE, 'runtime offline');
      return;
    }

    conn.helloDone = true;
    conn.scopes = verified.claims.scopes;
    state.devices.set(conn.connId, conn);
    if (msg.afterSeq >= 0) conn.lastSeq = msg.afterSeq;

    sendToDevice(conn.socket, { kind: 'welcome', runtime: state.welcome.runtime, lastSeq: state.ring.lastSeq, scopes: [...conn.scopes] });
    if (msg.afterSeq >= 0) {
      /* Gap: events were evicted from the ring, or the gateway restarted with an empty one while the runtime moved on. */
      const gap = state.ring.hasGapAfter(msg.afterSeq) || (state.ring.size === 0 && msg.afterSeq < state.welcome.lastSeq);
      if (gap) {
        sendToDevice(conn.socket, {
          kind: 'error',
          message: `replay-gap: events after seq ${msg.afterSeq} are no longer buffered (gateway keeps the last ${RELAY_RING_CAPACITY}); refresh state`,
        });
      }
      for (const e of state.ring.since(msg.afterSeq)) {
        conn.lastSeq = e.seq;
        sendToDevice(conn.socket, { kind: 'event', seq: e.seq, event: e.item });
      }
    }
    void store.devices.update(conn.deviceId, { lastSeenAt: iso(clock()) });
    await audit({ actor, action: 'relay.device.connect', target: conn.connId, ok: true, detail: `client=${msg.client.name}/${msg.client.version} kind=${msg.client.kind} afterSeq=${msg.afterSeq} ip=${conn.ip}` });
    log.info('device connected', { deviceId: conn.deviceId, runtimeId: conn.runtimeId, connId: conn.connId, afterSeq: msg.afterSeq });
  }

  async function handleDeviceRequest(conn: DeviceConn, msg: Extract<ClientMessage, { kind: 'request' }>): Promise<void> {
    const actor = `device:${conn.deviceId}`;
    /* (a) revocation is checked live on every request; access tokens are short-lived but not instant. */
    const fresh = await store.devices.get(conn.deviceId);
    if (!fresh || fresh.revoked) {
      await audit({ actor, action: 'relay.request.refused', target: msg.command, ok: false, detail: 'device revoked' });
      sendToDevice(conn.socket, { kind: 'response', id: msg.id, ok: false, error: { code: 'FORBIDDEN', message: 'device revoked' } });
      closeSocket(conn.socket, CLOSE_UNAUTHORIZED, 'device revoked');
      return;
    }
    /* (b) the command's scope must be one the device holds. The runtime never sees refused requests. */
    const required = commands[msg.command].scope;
    if (!conn.scopes.includes(required) || !fresh.scopes.includes(required)) {
      await audit({ actor, action: 'relay.request.refused', target: msg.command, ok: false, detail: `missing scope ${required}` });
      sendToDevice(conn.socket, {
        kind: 'response',
        id: msg.id,
        ok: false,
        error: { code: 'FORBIDDEN', message: `scope '${required}' is required for ${msg.command}` },
      });
      return;
    }
    const state = getState(conn.runtimeId);
    if (!state.socket) {
      await audit({ actor, action: 'relay.request', target: msg.command, ok: false, detail: 'runtime offline' });
      sendToDevice(conn.socket, { kind: 'response', id: msg.id, ok: false, error: { code: 'INTERNAL', message: 'runtime offline' } });
      return;
    }
    /* (c) prefix the id with the connection id so the response comes back to this socket only. */
    await audit({ actor, action: 'relay.request', target: msg.command, ok: true });
    sendToRuntime(state.socket, { kind: 'request', id: `${conn.connId}:${msg.id}`, command: msg.command, params: msg.params });
  }

  async function handleDeviceFrame(conn: DeviceConn, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = ClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      sendToDevice(conn.socket, { kind: 'error', message: 'invalid message' });
      return;
    }
    if (msg.kind === 'hello') return handleDeviceHello(conn, msg);
    if (!conn.helloDone) {
      sendToDevice(conn.socket, { kind: 'error', message: 'hello required' });
      return;
    }
    if (msg.kind === 'ping') {
      sendToDevice(conn.socket, { kind: 'pong', t: msg.t });
      return;
    }
    return handleDeviceRequest(conn, msg);
  }

  function attachDevice(socket: WebSocket, authd: DeviceAuth, ip: string): void {
    const conn: DeviceConn = {
      connId: newId('dconn'),
      deviceId: authd.device.deviceId,
      runtimeId: authd.device.runtimeId,
      scopes: authd.claims.scopes,
      socket,
      ip,
      helloDone: false,
      lastSeq: -1,
      alive: true,
    };
    const helloTimer = setTimeout(() => {
      if (!conn.helloDone) closeSocket(socket, CLOSE_HELLO_TIMEOUT, 'hello timeout');
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref();

    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('message', (data) => {
      handleDeviceFrame(conn, String(data)).catch((err: unknown) => {
        log.error('device frame handling failed', { deviceId: conn.deviceId, err: err instanceof Error ? err.message : String(err) });
        sendToDevice(socket, { kind: 'error', message: 'internal error' });
      });
    });
    socket.on('error', (err) => log.warn('device socket error', { deviceId: conn.deviceId, err: err.message }));
    socket.on('close', (code, reason) => {
      clearTimeout(helloTimer);
      const state = runtimes.get(conn.runtimeId);
      state?.devices.delete(conn.connId);
      if (conn.helloDone) {
        void audit({ actor: `device:${conn.deviceId}`, action: 'relay.device.disconnect', target: conn.connId, ok: true, detail: `code=${code} reason=${String(reason)}` });
        log.info('device disconnected', { deviceId: conn.deviceId, connId: conn.connId, code });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Liveness                                                           */
  /* ---------------------------------------------------------------- */

  const heartbeat = setInterval(() => {
    for (const state of runtimes.values()) {
      if (state.socket) {
        if (!state.alive) {
          log.warn('runtime heartbeat missed, terminating', { runtimeId: state.runtimeId });
          state.socket.terminate();
        } else {
          state.alive = false;
          state.socket.ping();
        }
      }
      for (const dev of state.devices.values()) {
        if (!dev.alive) dev.socket.terminate();
        else {
          dev.alive = false;
          dev.socket.ping();
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  /* ---------------------------------------------------------------- */
  /* Fastify plugin                                                     */
  /* ---------------------------------------------------------------- */

  const runtimeByRequest = new WeakMap<FastifyRequest, RuntimeRecord>();
  const deviceByRequest = new WeakMap<FastifyRequest, DeviceAuth>();

  const plugin: FastifyPluginAsync = async (app) => {
    app.get<{ Params: { id: string } }>(
      '/v1/runtimes/:id/connect',
      {
        websocket: true,
        preValidation: async (req, reply) => {
          try {
            const runtime = await auth.authenticateRuntime(req.headers.authorization);
            if (runtime.runtimeId !== req.params.id) {
              await audit({ actor: `runtime:${runtime.runtimeId}`, action: 'relay.runtime.connect', target: req.params.id, ok: false, detail: 'runtime id mismatch' });
              return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'runtime id mismatch' } });
            }
            runtimeByRequest.set(req, runtime);
            return undefined;
          } catch (err) {
            const e = toGatewayError(err);
            await audit({ actor: `ip:${req.ip}`, action: 'relay.runtime.connect', target: req.params.id, ok: false, detail: e.message });
            return reply.code(e.status).send(errorBody(e));
          }
        },
      },
      (socket, req) => {
        const runtime = runtimeByRequest.get(req);
        if (!runtime) {
          closeSocket(socket, CLOSE_UNAUTHORIZED, 'unauthorized');
          return;
        }
        attachRuntime(socket, runtime, req.ip);
      },
    );

    app.get(
      '/v1/devices/connect',
      {
        websocket: true,
        preValidation: async (req, reply) => {
          const query = req.query as Record<string, unknown> | undefined;
          if (query && ('token' in query || 'access_token' in query)) {
            /* Secrets in URLs end up in proxy and server logs; refuse outright. */
            await audit({ actor: `ip:${req.ip}`, action: 'relay.device.connect', ok: false, detail: 'credentials passed in URL' });
            return reply.code(400).send({ error: { code: 'INVALID_PARAMS', message: 'credentials must be sent in the Authorization header, never in the URL' } });
          }
          try {
            deviceByRequest.set(req, await auth.authenticateDevice(req.headers.authorization));
            return undefined;
          } catch (err) {
            const e = toGatewayError(err);
            await audit({ actor: `ip:${req.ip}`, action: 'relay.device.connect', ok: false, detail: e.message });
            return reply.code(e.status).send(errorBody(e));
          }
        },
      },
      (socket, req) => {
        const authd = deviceByRequest.get(req);
        if (!authd) {
          closeSocket(socket, CLOSE_UNAUTHORIZED, 'unauthorized');
          return;
        }
        attachDevice(socket, authd, req.ip);
      },
    );
  };

  function disconnectDevice(deviceId: string, reason: string): void {
    for (const state of runtimes.values()) {
      for (const dev of state.devices.values()) {
        if (dev.deviceId !== deviceId) continue;
        /* Unregister now: the close handshake can take a while and a revoked device must not receive another frame. */
        state.devices.delete(dev.connId);
        closeSocket(dev.socket, CLOSE_UNAUTHORIZED, reason);
      }
    }
  }

  return {
    plugin,
    isRuntimeConnected: (runtimeId) => runtimes.get(runtimeId)?.socket !== null && runtimes.has(runtimeId),
    isDeviceConnected: (deviceId) => {
      for (const state of runtimes.values()) for (const dev of state.devices.values()) if (dev.deviceId === deviceId && dev.helloDone) return true;
      return false;
    },
    connectedRuntimeCount: () => [...runtimes.values()].filter((s) => s.socket !== null).length,
    disconnectDevice,
    close: () => {
      clearInterval(heartbeat);
      for (const state of runtimes.values()) {
        for (const dev of state.devices.values()) closeSocket(dev.socket, 1001, 'gateway shutting down');
        if (state.socket) closeSocket(state.socket, 1001, 'gateway shutting down');
      }
    },
  };
}

export const RELAY_MAX_FRAME_BYTES = MAX_FRAME_BYTES;
