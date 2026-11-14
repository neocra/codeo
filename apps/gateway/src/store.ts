import type { CommandScope } from '@codeo/contracts';

/*
 * Persistence interfaces. Everything the gateway remembers lives behind these interfaces: the
 * in-memory implementation below (development, tests) and the PostgreSQL one (`postgres/store.ts`).
 * Timestamps are ISO-8601 strings; `now` arguments are epoch milliseconds (see clock.ts).
 */

export type DevicePlatform = 'ios' | 'android';

export interface RuntimeRecord {
  runtimeId: string;
  name: string;
  platform: string;
  ownerAccountId: string;
  /** sha256 hex of the registration secret; the secret itself is returned once and never stored. */
  runtimeSecretHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface DeviceRecord {
  deviceId: string;
  runtimeId: string;
  accountId: string;
  name: string;
  platform: DevicePlatform;
  /** Optional device public key supplied at pairing (reserved for request signing). */
  publicKey: string | null;
  scopes: CommandScope[];
  pairedAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
}

export interface PairingCodeRecord {
  id: string;
  /** Six decimal digits shown to the user. */
  code: string;
  /** Random nonce embedded in the QR payload; binds a scanned QR to this exact pairing. */
  nonce: string;
  runtimeId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface RefreshTokenRecord {
  id: string;
  /** sha256 hex of the opaque token. */
  tokenHash: string;
  deviceId: string;
  runtimeId: string;
  /** All tokens descending from one pairing share a family; reuse of a rotated member revokes the device. */
  familyId: string;
  createdAt: string;
  expiresAt: string;
  rotatedAt: string | null;
}

export type PushProvider = 'apns' | 'fcm';
export type PushLocale = 'fr' | 'en';

/**
 * Where to reach one paired phone with a push notification. One per device; the token is the APNs device
 * token (iOS) or the FCM registration token (Android). Payloads sent to it carry ids only (§5 of
 * docs/security/remote-access.md), so the token is not a secret, but it is never returned to a runtime.
 */
export interface PushTokenRecord {
  deviceId: string;
  runtimeId: string;
  provider: PushProvider;
  token: string;
  /** APNs only: tokens of development builds are only valid on the sandbox host. */
  environment: 'sandbox' | 'production';
  /** Language of the (generic) notification text. */
  locale: PushLocale;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  /** `runtime:<id>`, `device:<id>` or `ip:<addr>`. */
  actor: string;
  action: string;
  target: string | null;
  ok: boolean;
  /** Free text, already passed through secret redaction. Never contains command params. */
  detail: string | null;
}

export interface RuntimeStore {
  create(record: RuntimeRecord): Promise<void>;
  get(runtimeId: string): Promise<RuntimeRecord | null>;
  touch(runtimeId: string, lastSeenAt: string): Promise<void>;
}

export type DevicePatch = Partial<Pick<DeviceRecord, 'name' | 'scopes' | 'lastSeenAt' | 'revoked' | 'revokedAt'>>;

export interface DeviceStore {
  create(record: DeviceRecord): Promise<void>;
  get(deviceId: string): Promise<DeviceRecord | null>;
  listByRuntime(runtimeId: string): Promise<DeviceRecord[]>;
  update(deviceId: string, patch: DevicePatch): Promise<DeviceRecord | null>;
}

export interface PairingCodeStore {
  create(record: PairingCodeRecord): Promise<void>;
  /** True when an unused, unexpired record with this code exists (used to avoid ambiguous codes). */
  hasActive(code: string, now: number): Promise<boolean>;
  /**
   * Atomically marks the active record for `code` as used and returns it, or null when no unused,
   * unexpired record matches. Single use is guaranteed by this method (SQL: UPDATE … WHERE used_at IS NULL).
   */
  consume(code: string, now: number): Promise<PairingCodeRecord | null>;
  prune(now: number): Promise<void>;
}

export interface RefreshTokenStore {
  create(record: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Retires the token. True only for the call that moved it from active to rotated, so two refreshes
   * racing with the same token cannot both succeed (SQL: UPDATE … WHERE rotated_at IS NULL).
   */
  markRotated(id: string, rotatedAt: string): Promise<boolean>;
  deleteByDevice(deviceId: string): Promise<number>;
  prune(now: number): Promise<void>;
}

export interface PushTokenStore {
  /**
   * Sets the device's token. The same provider token held by another device (the phone paired again) is
   * removed in the same step, so a phone never receives one notification per old pairing.
   */
  upsert(record: PushTokenRecord): Promise<void>;
  get(deviceId: string): Promise<PushTokenRecord | null>;
  /** Tokens of the runtime's devices that are not revoked. */
  listByRuntime(runtimeId: string): Promise<PushTokenRecord[]>;
  /** True when a token was removed. */
  delete(deviceId: string): Promise<boolean>;
}

export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  /** Oldest first, the `limit` most recent matching entries (default 100). */
  list(opts?: { limit?: number; actor?: string; action?: string }): Promise<AuditEntry[]>;
  /** Drops entries older than `before` (ISO-8601). */
  prune(before: string): Promise<void>;
}

export interface GatewayStore {
  runtimes: RuntimeStore;
  devices: DeviceStore;
  pairingCodes: PairingCodeStore;
  refreshTokens: RefreshTokenStore;
  pushTokens: PushTokenStore;
  audit: AuditStore;
  /** Releases connections (no-op in memory). */
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation                                             */
/* ------------------------------------------------------------------ */

const isActive = (rec: PairingCodeRecord, now: number): boolean =>
  rec.usedAt === null && Date.parse(rec.expiresAt) > now;

export function createMemoryStore(): GatewayStore {
  const runtimes = new Map<string, RuntimeRecord>();
  const devices = new Map<string, DeviceRecord>();
  const pairingCodes = new Map<string, PairingCodeRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  const pushTokens = new Map<string, PushTokenRecord>();
  const auditLog: AuditEntry[] = [];
  const AUDIT_MAX = 10_000;

  return {
    runtimes: {
      async create(record) {
        if (runtimes.has(record.runtimeId)) throw new Error(`runtime ${record.runtimeId} already exists`);
        runtimes.set(record.runtimeId, { ...record });
      },
      async get(runtimeId) {
        const r = runtimes.get(runtimeId);
        return r ? { ...r } : null;
      },
      async touch(runtimeId, lastSeenAt) {
        const r = runtimes.get(runtimeId);
        if (r) r.lastSeenAt = lastSeenAt;
      },
    },
    devices: {
      async create(record) {
        if (devices.has(record.deviceId)) throw new Error(`device ${record.deviceId} already exists`);
        devices.set(record.deviceId, { ...record, scopes: [...record.scopes] });
      },
      async get(deviceId) {
        const d = devices.get(deviceId);
        return d ? { ...d, scopes: [...d.scopes] } : null;
      },
      async listByRuntime(runtimeId) {
        return [...devices.values()]
          .filter((d) => d.runtimeId === runtimeId)
          .map((d) => ({ ...d, scopes: [...d.scopes] }));
      },
      async update(deviceId, patch) {
        const d = devices.get(deviceId);
        if (!d) return null;
        if (patch.name !== undefined) d.name = patch.name;
        if (patch.scopes !== undefined) d.scopes = [...patch.scopes];
        if (patch.lastSeenAt !== undefined) d.lastSeenAt = patch.lastSeenAt;
        if (patch.revoked !== undefined) d.revoked = patch.revoked;
        if (patch.revokedAt !== undefined) d.revokedAt = patch.revokedAt;
        return { ...d, scopes: [...d.scopes] };
      },
    },
    pairingCodes: {
      async create(record) {
        pairingCodes.set(record.id, { ...record });
      },
      async hasActive(code, now) {
        for (const rec of pairingCodes.values()) if (rec.code === code && isActive(rec, now)) return true;
        return false;
      },
      async consume(code, now) {
        for (const rec of pairingCodes.values()) {
          if (rec.code === code && isActive(rec, now)) {
            rec.usedAt = new Date(now).toISOString();
            return { ...rec };
          }
        }
        return null;
      },
      async prune(now) {
        for (const [id, rec] of pairingCodes) if (!isActive(rec, now)) pairingCodes.delete(id);
      },
    },
    refreshTokens: {
      async create(record) {
        refreshTokens.set(record.id, { ...record });
      },
      async findByHash(tokenHash) {
        for (const rec of refreshTokens.values()) if (rec.tokenHash === tokenHash) return { ...rec };
        return null;
      },
      async markRotated(id, rotatedAt) {
        const rec = refreshTokens.get(id);
        if (!rec || rec.rotatedAt !== null) return false;
        rec.rotatedAt = rotatedAt;
        return true;
      },
      async deleteByDevice(deviceId) {
        let n = 0;
        for (const [id, rec] of refreshTokens) {
          if (rec.deviceId === deviceId) {
            refreshTokens.delete(id);
            n++;
          }
        }
        return n;
      },
      async prune(now) {
        for (const [id, rec] of refreshTokens) if (Date.parse(rec.expiresAt) <= now) refreshTokens.delete(id);
      },
    },
    pushTokens: {
      async upsert(record) {
        for (const [deviceId, rec] of pushTokens) {
          if (deviceId !== record.deviceId && rec.provider === record.provider && rec.token === record.token) pushTokens.delete(deviceId);
        }
        pushTokens.set(record.deviceId, { ...record });
      },
      async get(deviceId) {
        const rec = pushTokens.get(deviceId);
        return rec ? { ...rec } : null;
      },
      async listByRuntime(runtimeId) {
        return [...pushTokens.values()]
          .filter((rec) => rec.runtimeId === runtimeId && devices.get(rec.deviceId)?.revoked === false)
          .map((rec) => ({ ...rec }));
      },
      async delete(deviceId) {
        return pushTokens.delete(deviceId);
      },
    },
    audit: {
      async append(entry) {
        auditLog.push({ ...entry });
        if (auditLog.length > AUDIT_MAX) auditLog.splice(0, auditLog.length - AUDIT_MAX);
      },
      async list(opts = {}) {
        let out = auditLog;
        if (opts.actor !== undefined) out = out.filter((e) => e.actor === opts.actor);
        if (opts.action !== undefined) out = out.filter((e) => e.action === opts.action);
        const limit = opts.limit ?? 100;
        return out.slice(-limit).map((e) => ({ ...e }));
      },
      async prune(before) {
        const cutoff = Date.parse(before);
        const keep = auditLog.filter((e) => Date.parse(e.at) >= cutoff);
        auditLog.splice(0, auditLog.length, ...keep);
      },
    },
    async close() {},
  };
}
