import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newId, type Logger } from '@codeo/shared-utils';
import type { Auditor } from './audit';
import type { AuthService } from './auth';
import { iso, type Clock } from './clock';
import { GatewayError } from './errors';
import type { PairingService } from './pairing';
import { createRateLimiter } from './rate-limit';
import type { Relay } from './relay';
import type { DeviceRecord, GatewayStore, RuntimeRecord } from './store';
import { generateRuntimeSecret, hashSecret } from './tokens';

export interface RouteDeps {
  store: GatewayStore;
  auth: AuthService;
  pairing: PairingService;
  relay: Relay;
  audit: Auditor;
  clock: Clock;
  log: Logger;
  version: string;
  startedAt: number;
}

/* Request bodies — every body is validated with zod before it is used. */
const RegisterRuntimeBody = z.object({
  name: z.string().min(1).max(120),
  platform: z.enum(['darwin', 'win32', 'linux']),
  /** Account the runtime belongs to; generated when the caller has none yet (phase 1 has no account system). */
  ownerAccountId: z.string().min(3).max(80).optional(),
});

const PairingCompleteBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  nonce: z.string().min(8).max(64).optional(),
  runtimeId: z.string().min(3).max(80).optional(),
  device: z.object({ name: z.string().min(1).max(120), platform: z.enum(['ios', 'android']) }),
  publicKey: z.string().min(16).max(4096).optional(),
});

const RefreshBody = z.object({ refreshToken: z.string().min(16).max(512) });

const DeviceIdParams = z.object({ id: z.string().min(3).max(80) });

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new GatewayError(400, 'INVALID_PARAMS', detail);
  }
  return result.data;
}

/** What a runtime may see about its paired devices — no secrets, no token hashes. */
function deviceView(d: DeviceRecord, connected: boolean) {
  return {
    deviceId: d.deviceId,
    name: d.name,
    platform: d.platform,
    scopes: d.scopes,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
    revoked: d.revoked,
    revokedAt: d.revokedAt,
    connected,
  };
}

export function createRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { store, auth, pairing, relay, audit, clock, log } = deps;
  const registerLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000, clock });

  const requireRuntime = (req: FastifyRequest): Promise<RuntimeRecord> => auth.authenticateRuntime(req.headers.authorization);

  return async (app) => {
    app.get('/healthz', async () => ({
      ok: true,
      version: deps.version,
      uptimeSeconds: Math.floor((clock() - deps.startedAt) / 1000),
      runtimesConnected: relay.connectedRuntimeCount(),
    }));

    app.post('/v1/runtimes/register', async (req, reply) => {
      const limit = registerLimiter.hit(req.ip);
      if (!limit.allowed) throw new GatewayError(429, 'RATE_LIMITED', 'too many registrations from this address');
      const body = parseWith(RegisterRuntimeBody, req.body);
      const runtimeId = newId('rt');
      const secret = generateRuntimeSecret(runtimeId);
      const createdAt = iso(clock());
      const ownerAccountId = body.ownerAccountId ?? newId('acct');
      await store.runtimes.create({
        runtimeId,
        name: body.name,
        platform: body.platform,
        ownerAccountId,
        runtimeSecretHash: hashSecret(secret),
        createdAt,
        lastSeenAt: null,
      });
      await audit({ actor: `ip:${req.ip}`, action: 'runtime.register', target: runtimeId, ok: true, detail: `platform=${body.platform}` });
      log.info('runtime registered', { runtimeId, platform: body.platform });
      /* The secret is returned exactly once; only its hash is stored. */
      return reply.code(201).send({ runtimeId, runtimeSecret: secret, ownerAccountId, createdAt });
    });

    app.post('/v1/pairing/start', async (req, reply) => {
      const runtime = await requireRuntime(req);
      const result = await pairing.start(runtime);
      return reply.code(201).send(result);
    });

    app.post('/v1/pairing/complete', async (req, reply) => {
      const body = parseWith(PairingCompleteBody, req.body);
      const result = await pairing.complete(body, { ip: req.ip });
      return reply.code(201).send(result);
    });

    app.post('/v1/auth/refresh', async (req) => {
      const body = parseWith(RefreshBody, req.body);
      return auth.refresh(body.refreshToken, { ip: req.ip });
    });

    app.get('/v1/devices', async (req) => {
      const runtime = await requireRuntime(req);
      const devices = await store.devices.listByRuntime(runtime.runtimeId);
      return { devices: devices.map((d) => deviceView(d, relay.isDeviceConnected(d.deviceId))) };
    });

    app.post('/v1/devices/:id/revoke', async (req) => {
      const runtime = await requireRuntime(req);
      const { id } = parseWith(DeviceIdParams, req.params);
      const device = await store.devices.get(id);
      /* A device of another runtime is reported as not found, not as forbidden. */
      if (!device || device.runtimeId !== runtime.runtimeId) throw new GatewayError(404, 'NOT_FOUND', 'device not found');
      const updated = (await auth.revokeDevice(id, `runtime:${runtime.runtimeId}`, 'revoked by runtime owner')) ?? device;
      return { deviceId: updated.deviceId, revoked: updated.revoked, revokedAt: updated.revokedAt };
    });
  };
}
