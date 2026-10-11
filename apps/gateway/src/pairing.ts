import { randomBytes, randomInt } from 'node:crypto';
import { newId, type Logger } from '@codeo/shared-utils';
import type { Auditor } from './audit';
import { DEFAULT_DEVICE_SCOPES, type AuthService, type IssuedCredentials } from './auth';
import { iso, type Clock } from './clock';
import { GatewayError } from './errors';
import { createRateLimiter } from './rate-limit';
import type { DevicePlatform, DeviceRecord, GatewayStore, RuntimeRecord } from './store';
import { safeEqual } from './tokens';

export interface PairingStartResult {
  code: string;
  /** ISO-8601. */
  expiresAt: string;
  /** JSON string the desktop shows as a QR code: `{ v: 1, gateway, code, runtimeId, nonce }`. */
  qrPayload: string;
}

export interface PairingCompleteInput {
  code: string;
  /** From the QR payload; when present it must match the code's nonce (manual entry omits it). */
  nonce?: string | undefined;
  /** From the QR payload; when present it must match the runtime that started the pairing. */
  runtimeId?: string | undefined;
  device: { name: string; platform: DevicePlatform };
  publicKey?: string | undefined;
}

export interface PairingCompleteResult extends IssuedCredentials {
  device: { deviceId: string; name: string; platform: DevicePlatform; pairedAt: string };
}

export interface PairingServiceOptions {
  store: GatewayStore;
  auth: AuthService;
  clock: Clock;
  audit: Auditor;
  log: Logger;
  publicUrl: string;
  codeTtlSeconds: number;
  /** Max completion attempts per IP per window (default 10 / 5 min). */
  completeRateLimit?: { max: number; windowMs: number } | undefined;
}

export interface PairingService {
  start(runtime: RuntimeRecord): Promise<PairingStartResult>;
  complete(input: PairingCompleteInput, ctx: { ip: string }): Promise<PairingCompleteResult>;
}

const CODE_GENERATION_ATTEMPTS = 20;

export function createPairingService(opts: PairingServiceOptions): PairingService {
  const { store, auth, clock, audit, log } = opts;
  const limiter = createRateLimiter({
    max: opts.completeRateLimit?.max ?? 10,
    windowMs: opts.completeRateLimit?.windowMs ?? 5 * 60_000,
    clock,
  });

  async function start(runtime: RuntimeRecord): Promise<PairingStartResult> {
    const now = clock();
    await store.pairingCodes.prune(now);
    let code: string | null = null;
    for (let i = 0; i < CODE_GENERATION_ATTEMPTS && code === null; i++) {
      const candidate = randomInt(0, 1_000_000).toString().padStart(6, '0');
      if (!(await store.pairingCodes.hasActive(candidate, now))) code = candidate;
    }
    if (code === null) throw new GatewayError(503, 'INTERNAL', 'could not allocate a pairing code, retry later');

    const nonce = randomBytes(16).toString('base64url');
    const expiresAt = iso(now + opts.codeTtlSeconds * 1000);
    const id = newId('pair');
    await store.pairingCodes.create({ id, code, nonce, runtimeId: runtime.runtimeId, createdAt: iso(now), expiresAt, usedAt: null });
    await audit({ actor: `runtime:${runtime.runtimeId}`, action: 'pairing.start', target: id, ok: true, detail: `expiresAt=${expiresAt}` });
    const qrPayload = JSON.stringify({ v: 1, gateway: opts.publicUrl, code, runtimeId: runtime.runtimeId, nonce });
    return { code, expiresAt, qrPayload };
  }

  async function complete(input: PairingCompleteInput, ctx: { ip: string }): Promise<PairingCompleteResult> {
    const actor = `ip:${ctx.ip}`;
    const limit = limiter.hit(ctx.ip);
    if (!limit.allowed) {
      await audit({ actor, action: 'pairing.complete', ok: false, detail: 'rate limited' });
      throw new GatewayError(429, 'RATE_LIMITED', `too many pairing attempts, retry in ${Math.ceil(limit.retryAfterMs / 1000)}s`);
    }

    const now = clock();
    const record = await store.pairingCodes.consume(input.code, now);
    const bound =
      record !== null &&
      (input.nonce === undefined || safeEqual(input.nonce, record.nonce)) &&
      (input.runtimeId === undefined || input.runtimeId === record.runtimeId);
    if (!record || !bound) {
      /* A consumed-but-mismatched code is burnt on purpose: guessing attempts cost the attacker the code. */
      await audit({ actor, action: 'pairing.complete', target: record?.id ?? null, ok: false, detail: record ? 'qr binding mismatch' : 'code invalid or expired' });
      throw new GatewayError(404, 'NOT_FOUND', 'pairing code invalid or expired');
    }

    const runtime = await store.runtimes.get(record.runtimeId);
    if (!runtime) {
      await audit({ actor, action: 'pairing.complete', target: record.id, ok: false, detail: 'runtime missing' });
      throw new GatewayError(404, 'NOT_FOUND', 'pairing code invalid or expired');
    }

    const device: DeviceRecord = {
      deviceId: newId('dev'),
      runtimeId: runtime.runtimeId,
      accountId: runtime.ownerAccountId,
      name: input.device.name,
      platform: input.device.platform,
      publicKey: input.publicKey ?? null,
      scopes: [...DEFAULT_DEVICE_SCOPES],
      pairedAt: iso(now),
      lastSeenAt: null,
      revoked: false,
      revokedAt: null,
    };
    await store.devices.create(device);
    const creds = await auth.issueCredentials(device);
    limiter.reset(ctx.ip);
    await audit({ actor: `device:${device.deviceId}`, action: 'pairing.complete', target: record.id, ok: true, detail: `runtime=${runtime.runtimeId} platform=${device.platform} ip=${ctx.ip}` });
    log.info('device paired', { deviceId: device.deviceId, runtimeId: runtime.runtimeId, platform: device.platform });
    return { ...creds, device: { deviceId: device.deviceId, name: device.name, platform: device.platform, pairedAt: device.pairedAt } };
  }

  return { start, complete };
}
