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
import { createPairingService } from './pairing';
import { createRelay, RELAY_MAX_FRAME_BYTES, type Relay } from './relay';
import { createRoutes } from './routes';
import type { GatewayStore } from './store';
import { TokenService } from './tokens';

export const GATEWAY_VERSION = '0.1.0';

export interface BuildAppOptions {
  logger?: Logger | undefined;
  /** Injectable clock (tests advance it to exercise expiry). */
  clock?: Clock | undefined;
}

export interface GatewayApp {
  app: FastifyInstance;
  relay: Relay;
  auth: AuthService;
  tokens: TokenService;
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
  const relay = createRelay({ store, auth, audit, clock, log, version: GATEWAY_VERSION });
  auth.events.on('deviceRevoked', ({ deviceId, reason }) => relay.disconnectDevice(deviceId, reason));

  await app.register(websocket, { options: { maxPayload: RELAY_MAX_FRAME_BYTES } });
  await app.register(relay.plugin);
  await app.register(createRoutes({ store, auth, pairing, relay, audit, clock, log: log.child('http'), version: GATEWAY_VERSION, startedAt }));
  app.addHook('onClose', async () => relay.close());

  return { app, relay, auth, tokens };
}
