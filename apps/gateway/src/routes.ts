import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newId, type Logger } from '@codeo/shared-utils';
import type { Auditor } from './audit';
import type { AuthService } from './auth';
import { iso, type Clock } from './clock';
import { GatewayError } from './errors';
import type { PairingService } from './pairing';
import type { PushDispatcher } from './push';
import { createRateLimiter } from './rate-limit';
import type { Relay } from './relay';
import type { DeviceRecord, GatewayStore, RuntimeRecord } from './store';
import { generateRuntimeSecret, hashSecret } from './tokens';

export interface RouteDeps {
  store: GatewayStore;
  auth: AuthService;
  pairing: PairingService;
  relay: Relay;
  push: PushDispatcher;
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

/*
 * A phone's push token. APNs device tokens are hex; FCM registration tokens are base64url-ish with ':'.
 * The provider follows the platform the device paired as.
 */
const PushTokenBody = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('apns'),
    token: z.string().regex(/^[0-9a-fA-F]{64,200}$/, 'not an APNs device token'),
    environment: z.enum(['sandbox', 'production']).default('production'),
    locale: z.enum(['fr', 'en']).default('fr'),
  }),
  z.object({
    provider: z.literal('fcm'),
    token: z.string().regex(/^[A-Za-z0-9:_\-.]{32,4096}$/, 'not an FCM registration token'),
    locale: z.enum(['fr', 'en']).default('fr'),
  }),
]);

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

const PROVIDER_FOR_PLATFORM = { ios: 'apns', android: 'fcm' } as const;

export function createRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { store, auth, pairing, relay, push, audit, clock, log } = deps;
  const pushLimiter = createRateLimiter({ max: 30, windowMs: 60 * 60_000, clock });
  const registerLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000, clock });

  const requireRuntime = (req: FastifyRequest): Promise<RuntimeRecord> => auth.authenticateRuntime(req.headers.authorization);

  return async (app) => {
    app.get('/healthz', async () => ({
      ok: true,
      version: deps.version,
      uptimeSeconds: Math.floor((clock() - deps.startedAt) / 1000),
      runtimesConnected: relay.connectedRuntimeCount(),
      push: push.enabled,
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

    /* The phone's own push registration. `delivery` says whether this gateway can actually send through the
     * provider: a gateway without APNs / FCM credentials keeps the token and reports it, it never pretends. */
    app.put('/v1/devices/me/push', async (req) => {
      const { device } = await auth.authenticateDevice(req.headers.authorization);
      if (!pushLimiter.hit(device.deviceId).allowed) throw new GatewayError(429, 'RATE_LIMITED', 'too many push registrations');
      const body = parseWith(PushTokenBody, req.body);
      if (PROVIDER_FOR_PLATFORM[device.platform] !== body.provider) {
        throw new GatewayError(400, 'INVALID_PARAMS', `a ${device.platform} device registers ${PROVIDER_FOR_PLATFORM[device.platform]} tokens`);
      }
      await store.pushTokens.upsert({
        deviceId: device.deviceId,
        runtimeId: device.runtimeId,
        provider: body.provider,
        token: body.token,
        environment: body.provider === 'apns' ? body.environment : 'production',
        locale: body.locale,
        updatedAt: iso(clock()),
      });
      const delivery = push.enabled.includes(body.provider) ? 'enabled' : 'unconfigured';
      await audit({ actor: `device:${device.deviceId}`, action: 'push.register', target: device.deviceId, ok: true, detail: `provider=${body.provider} delivery=${delivery}` });
      return { provider: body.provider, delivery };
    });

    app.delete('/v1/devices/me/push', async (req) => {
      const { device } = await auth.authenticateDevice(req.headers.authorization);
      const removed = await store.pushTokens.delete(device.deviceId);
      await audit({ actor: `device:${device.deviceId}`, action: 'push.unregister', target: device.deviceId, ok: true, detail: `removed=${removed}` });
      return { removed };
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
