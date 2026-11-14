import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import Fastify, { type FastifyHttpOptions, type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { createLogger, type Logger } from '@codeo/shared-utils';
import { createAuditor } from './audit';
import { createAuthService, type AuthService } from './auth';
import { systemClock, type Clock } from './clock';
import type { GatewayConfig } from './config';
import { errorBody, GatewayError, type GatewayErrorCode } from './errors';
import { runMaintenance } from './maintenance';
import { createPairingService } from './pairing';
import { createPushDispatcher, createPushSenders, type PushDispatcher, type PushSender } from './push';
import { createRelay, RELAY_MAX_FRAME_BYTES, type Relay } from './relay';
import { createRoutes } from './routes';
import type { GatewayStore, PushProvider } from './store';
import { TokenService } from './tokens';

export const GATEWAY_VERSION = '0.1.0';

export interface BuildAppOptions {
  logger?: Logger | undefined;
  /** Injectable clock (tests advance it to exercise expiry). */
  clock?: Clock | undefined;
  /** How often expired codes, tokens and old audit entries are deleted (default 1 h; 0 disables). */
  maintenanceIntervalMs?: number | undefined;
  /** Push senders; defaults to the ones `config.push` has credentials for (tests inject fakes). */
  pushSenders?: Partial<Record<PushProvider, PushSender>> | undefined;
}

export interface GatewayApp {
  app: FastifyInstance;
  relay: Relay;
  auth: AuthService;
  tokens: TokenService;
  push: PushDispatcher;
}

function codeForStatus(status: number): GatewayErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'INVALID_PARAMS';
}

/**
 * Builds the gateway without listening. Tests call `inject` on the returned app or `listen({ port: 0 })`
 * for WebSocket scenarios. Nothing here touches a repository or runs a command: the gateway relays.
 */
export async function buildApp(config: GatewayConfig, store: GatewayStore, opts: BuildAppOptions = {}): Promise<GatewayApp> {
  const log = opts.logger ?? createLogger({ scope: 'gateway', level: config.logLevel });
  const clock = opts.clock ?? systemClock;
  const startedAt = clock();

  const serverOptions: FastifyHttpOptions<HttpServer> = {
    logger: false,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  };
  if (config.tls) {
    const cert = readFileSync(config.tls.certPath);
    const key = readFileSync(config.tls.keyPath);
    serverOptions.serverFactory = (handler) => createHttpsServer({ cert, key }, handler);
  }
  const app = Fastify(serverOptions);

  app.setErrorHandler((raw: unknown, req, reply) => {
    const err = raw as { statusCode?: number; message: string; stack?: string };
    if (raw instanceof GatewayError) {
      const err = raw;
      if (err.status >= 500) log.error('request failed', { method: req.method, url: req.url, code: err.code, message: err.message });
      return reply.code(err.status).send(errorBody(err));
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: codeForStatus(status), message: err.message } });
    }
    log.error('unhandled error', { method: req.method, url: req.url, err: err.stack ?? err.message });
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } }));

  const audit = createAuditor(store.audit, clock, log.child('audit'));
  const tokens = new TokenService(config.secret);
  const auth = createAuthService({
    store,
    tokens,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
    clock,
    audit,
    log: log.child('auth'),
  });
  const pairing = createPairingService({
    store,
    auth,
    clock,
    audit,
    log: log.child('pairing'),
    publicUrl: config.publicUrl,
    codeTtlSeconds: config.pairingCodeTtlSeconds,
  });
  const push = createPushDispatcher({
    store,
    senders: opts.pushSenders ?? createPushSenders(config.push, clock),
    clock,
    audit,
    log: log.child('push'),
  });
  const relay = createRelay({ store, auth, audit, clock, log, version: GATEWAY_VERSION, onRuntimeEvent: push.onRuntimeEvent });
  auth.events.on('deviceRevoked', ({ deviceId, reason }) => {
    relay.disconnectDevice(deviceId, reason);
    /* A revoked phone must not keep receiving even content-free notifications. */
    store.pushTokens.delete(deviceId).catch((err: unknown) => log.warn('push token removal failed', { deviceId, err: err instanceof Error ? err.message : String(err) }));
  });

  await app.register(websocket, { options: { maxPayload: RELAY_MAX_FRAME_BYTES } });
  await app.register(relay.plugin);
  await app.register(createRoutes({ store, auth, pairing, relay, push, audit, clock, log: log.child('http'), version: GATEWAY_VERSION, startedAt }));
  const maintenanceIntervalMs = opts.maintenanceIntervalMs ?? 60 * 60 * 1000;
  let maintenance: Promise<void> = Promise.resolve();
  const timer =
    maintenanceIntervalMs > 0
      ? setInterval(() => {
          maintenance = runMaintenance({ store, clock, log: log.child('maintenance'), auditRetentionDays: config.auditRetentionDays });
        }, maintenanceIntervalMs)
      : null;
  timer?.unref();
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    await maintenance;
    await relay.close();
    await push.close();
  });

  return { app, relay, auth, tokens, push };
}
