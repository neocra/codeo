import type { CommandScope } from '@codeo/contracts';
import { newId, TypedEmitter, type Logger } from '@codeo/shared-utils';
import type { Auditor } from './audit';
import { iso, type Clock } from './clock';
import { GatewayError } from './errors';
import type { DeviceRecord, GatewayStore, RuntimeRecord } from './store';
import { generateRefreshToken, hashSecret, runtimeIdFromSecret, safeEqual, type TokenService, type AccessTokenClaims } from './tokens';

/** Scopes granted to a freshly paired mobile device. `workspace:admin` is never granted remotely. */
export const DEFAULT_DEVICE_SCOPES: readonly CommandScope[] = ['read', 'session:write', 'approval:decide'];

export interface IssuedCredentials {
  accessToken: string;
  /** ISO-8601. */
  accessTokenExpiresAt: string;
  refreshToken: string;
  scopes: CommandScope[];
  runtimeId: string;
  deviceId: string;
}

export interface DeviceAuth {
  device: DeviceRecord;
  /** Claims with scopes narrowed to the device's current scopes. */
  claims: AccessTokenClaims;
}

export interface AuthServiceOptions {
  store: GatewayStore;
  tokens: TokenService;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  clock: Clock;
  audit: Auditor;
  log: Logger;
}

interface AuthEvents extends Record<string, unknown> {
  deviceRevoked: { deviceId: string; reason: string };
}

export interface AuthService {
  readonly events: TypedEmitter<AuthEvents>;
  /** Resolves the runtime behind an `Authorization: Bearer <runtimeSecret>` header. */
  authenticateRuntime(authorization: string | undefined): Promise<RuntimeRecord>;
  /** Resolves the device behind an `Authorization: Bearer <accessToken>` header. */
  authenticateDevice(authorization: string | undefined): Promise<DeviceAuth>;
  verifyDeviceToken(token: string): Promise<DeviceAuth>;
  issueCredentials(device: DeviceRecord, familyId?: string): Promise<IssuedCredentials>;
  refresh(refreshToken: string, ctx: { ip: string }): Promise<IssuedCredentials>;
  revokeDevice(deviceId: string, actor: string, reason: string): Promise<DeviceRecord | null>;
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const { store, tokens, clock, audit, log } = opts;
  const events = new TypedEmitter<AuthEvents>();

  const unauthenticated = (message = 'invalid credentials') => new GatewayError(401, 'UNAUTHENTICATED', message);

  async function authenticateRuntime(authorization: string | undefined): Promise<RuntimeRecord> {
    const secret = bearerToken(authorization);
    if (!secret) throw unauthenticated('missing bearer credentials');
    const runtimeId = runtimeIdFromSecret(secret);
    if (!runtimeId) throw unauthenticated();
    const runtime = await store.runtimes.get(runtimeId);
    /* Same error for unknown id and wrong secret: do not reveal which runtimes exist. */
    if (!runtime || !safeEqual(hashSecret(secret), runtime.runtimeSecretHash)) throw unauthenticated();
    return runtime;
  }

  async function verifyDeviceToken(token: string): Promise<DeviceAuth> {
    const verified = tokens.verifyAccessToken(token, clock());
    if (!verified.ok) {
      throw unauthenticated(verified.reason === 'expired' ? 'access token expired' : 'invalid access token');
    }
    const device = await store.devices.get(verified.claims.deviceId);
    if (!device || device.runtimeId !== verified.claims.runtimeId) throw unauthenticated();
    if (device.revoked) throw new GatewayError(403, 'FORBIDDEN', 'device revoked');
    /* The device record is the source of truth: scopes removed after issuance are not honoured. */
    const scopes = verified.claims.scopes.filter((s) => device.scopes.includes(s));
    return { device, claims: { ...verified.claims, scopes } };
  }

  async function authenticateDevice(authorization: string | undefined): Promise<DeviceAuth> {
    const token = bearerToken(authorization);
    if (!token) throw unauthenticated('missing bearer credentials');
    return verifyDeviceToken(token);
  }

  async function issueCredentials(device: DeviceRecord, familyId: string = newId('fam')): Promise<IssuedCredentials> {
    const now = clock();
    const access = tokens.issueAccessToken({
      deviceId: device.deviceId,
      runtimeId: device.runtimeId,
      scopes: device.scopes,
      ttlSeconds: opts.accessTokenTtlSeconds,
      now,
    });
    const refreshToken = generateRefreshToken();
    await store.refreshTokens.create({
      id: newId('rft'),
      tokenHash: hashSecret(refreshToken),
      deviceId: device.deviceId,
      runtimeId: device.runtimeId,
      familyId,
      createdAt: iso(now),
      expiresAt: iso(now + opts.refreshTokenTtlSeconds * 1000),
      rotatedAt: null,
    });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: iso(access.expiresAt),
      refreshToken,
      scopes: [...device.scopes],
      runtimeId: device.runtimeId,
      deviceId: device.deviceId,
    };
  }

  async function revokeDevice(deviceId: string, actor: string, reason: string): Promise<DeviceRecord | null> {
    const device = await store.devices.get(deviceId);
    if (!device) return null;
    const updated = device.revoked
      ? device
      : ((await store.devices.update(deviceId, { revoked: true, revokedAt: iso(clock()) })) ?? device);
    const dropped = await store.refreshTokens.deleteByDevice(deviceId);
    await audit({ actor, action: 'device.revoke', target: deviceId, ok: true, detail: `${reason}; refreshTokensDropped=${dropped}` });
    log.info('device revoked', { deviceId, reason, actor });
    events.emit('deviceRevoked', { deviceId, reason });
    return updated;
  }

  async function refresh(refreshToken: string, ctx: { ip: string }): Promise<IssuedCredentials> {
    const actor = `ip:${ctx.ip}`;
    const record = await store.refreshTokens.findByHash(hashSecret(refreshToken));
    if (!record) {
      await audit({ actor, action: 'auth.refresh', ok: false, detail: 'unknown refresh token' });
      throw unauthenticated('invalid refresh token');
    }
    if (record.rotatedAt !== null) {
      /* Replay: a token that was already rotated is presented again. Someone holds a stolen copy
       * (either the attacker or the legitimate device); the only safe move is to cut the whole device off. */
      await audit({ actor, action: 'auth.refresh.reuse', target: record.deviceId, ok: false, detail: `family=${record.familyId}` });
      await revokeDevice(record.deviceId, actor, 'refresh token reuse detected');
      throw unauthenticated('refresh token reuse detected; device revoked');
    }
    const now = clock();
    if (Date.parse(record.expiresAt) <= now) {
      await audit({ actor, action: 'auth.refresh', target: record.deviceId, ok: false, detail: 'refresh token expired' });
      throw unauthenticated('refresh token expired');
    }
    const device = await store.devices.get(record.deviceId);
    if (!device) throw unauthenticated();
    if (device.revoked) {
      await audit({ actor, action: 'auth.refresh', target: device.deviceId, ok: false, detail: 'device revoked' });
      throw new GatewayError(403, 'FORBIDDEN', 'device revoked');
    }
    /* Rotate: the presented token is retired (kept until expiry for reuse detection), a new one is issued. */
    await store.refreshTokens.markRotated(record.id, iso(now));
    const creds = await issueCredentials(device, record.familyId);
    await store.devices.update(device.deviceId, { lastSeenAt: iso(now) });
    await audit({ actor: `device:${device.deviceId}`, action: 'auth.refresh', target: device.deviceId, ok: true, detail: `family=${record.familyId}` });
    return creds;
  }

  return { events, authenticateRuntime, authenticateDevice, verifyDeviceToken, issueCredentials, refresh, revokeDevice };
}
