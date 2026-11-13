import type { CommandScope } from '@codeo/contracts';
import type {
  AuditEntry,
  DevicePlatform,
  DeviceRecord,
  GatewayStore,
  PairingCodeRecord,
  RefreshTokenRecord,
  RuntimeRecord,
} from '../store';
import type { SqlDatabase } from './db';

/*
 * PostgreSQL implementation of GatewayStore. Every state change that decides security (single-use
 * pairing codes, refresh token rotation) is one conditional UPDATE, so concurrent requests and
 * several gateway processes cannot both win.
 */

type Ts = Date | string | null;

const toIso = (v: Ts): string | null => (v === null ? null : new Date(v).toISOString());
const reqIso = (v: Ts): string => toIso(v) ?? new Date(0).toISOString();
const at = (ms: number): string => new Date(ms).toISOString();

interface RuntimeRow {
  runtime_id: string;
  name: string;
  platform: string;
  owner_account_id: string;
  runtime_secret_hash: string;
  created_at: Ts;
  last_seen_at: Ts;
}

interface DeviceRow {
  device_id: string;
  runtime_id: string;
  account_id: string;
  name: string;
  platform: DevicePlatform;
  public_key: string | null;
  scopes: string[];
  paired_at: Ts;
  last_seen_at: Ts;
  revoked: boolean;
  revoked_at: Ts;
}

interface PairingRow {
  id: string;
  code: string;
  nonce: string;
  runtime_id: string;
  created_at: Ts;
  expires_at: Ts;
  used_at: Ts;
}

interface RefreshRow {
  id: string;
  token_hash: string;
  device_id: string;
  runtime_id: string;
  family_id: string;
  created_at: Ts;
  expires_at: Ts;
  rotated_at: Ts;
}

interface AuditRow {
  id: string;
  at: Ts;
  actor: string;
  action: string;
  target: string | null;
  ok: boolean;
  detail: string | null;
}

const runtimeFromRow = (r: RuntimeRow): RuntimeRecord => ({
  runtimeId: r.runtime_id,
  name: r.name,
  platform: r.platform,
  ownerAccountId: r.owner_account_id,
  runtimeSecretHash: r.runtime_secret_hash,
  createdAt: reqIso(r.created_at),
  lastSeenAt: toIso(r.last_seen_at),
});

const deviceFromRow = (r: DeviceRow): DeviceRecord => ({
  deviceId: r.device_id,
  runtimeId: r.runtime_id,
  accountId: r.account_id,
  name: r.name,
  platform: r.platform,
  publicKey: r.public_key,
  /* Written from CommandScope[] only; read back as such. */
  scopes: [...r.scopes] as CommandScope[],
  pairedAt: reqIso(r.paired_at),
  lastSeenAt: toIso(r.last_seen_at),
  revoked: r.revoked,
  revokedAt: toIso(r.revoked_at),
});

const pairingFromRow = (r: PairingRow): PairingCodeRecord => ({
  id: r.id,
  code: r.code,
  nonce: r.nonce,
  runtimeId: r.runtime_id,
  createdAt: reqIso(r.created_at),
  expiresAt: reqIso(r.expires_at),
  usedAt: toIso(r.used_at),
});

const refreshFromRow = (r: RefreshRow): RefreshTokenRecord => ({
  id: r.id,
  tokenHash: r.token_hash,
  deviceId: r.device_id,
  runtimeId: r.runtime_id,
  familyId: r.family_id,
  createdAt: reqIso(r.created_at),
  expiresAt: reqIso(r.expires_at),
  rotatedAt: toIso(r.rotated_at),
});

const auditFromRow = (r: AuditRow): AuditEntry => ({
  id: r.id,
  at: reqIso(r.at),
  actor: r.actor,
  action: r.action,
  target: r.target,
  ok: r.ok,
  detail: r.detail,
});

/** Builds the store on an already migrated database (see `migrate`). `close` closes the database. */
export function createPostgresStore(db: SqlDatabase): GatewayStore {
  return {
    runtimes: {
      async create(r) {
        await db.query(
          `INSERT INTO gateway_runtimes (runtime_id, name, platform, owner_account_id, runtime_secret_hash, created_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.runtimeId, r.name, r.platform, r.ownerAccountId, r.runtimeSecretHash, r.createdAt, r.lastSeenAt],
        );
      },
      async get(runtimeId) {
        const res = await db.query<RuntimeRow>('SELECT * FROM gateway_runtimes WHERE runtime_id = $1', [runtimeId]);
        const row = res.rows[0];
        return row ? runtimeFromRow(row) : null;
      },
      async touch(runtimeId, lastSeenAt) {
        await db.query('UPDATE gateway_runtimes SET last_seen_at = $2 WHERE runtime_id = $1', [runtimeId, lastSeenAt]);
      },
    },
    devices: {
      async create(d) {
        await db.query(
          `INSERT INTO gateway_devices (device_id, runtime_id, account_id, name, platform, public_key, scopes, paired_at, last_seen_at, revoked, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [d.deviceId, d.runtimeId, d.accountId, d.name, d.platform, d.publicKey, [...d.scopes], d.pairedAt, d.lastSeenAt, d.revoked, d.revokedAt],
        );
      },
      async get(deviceId) {
        const res = await db.query<DeviceRow>('SELECT * FROM gateway_devices WHERE device_id = $1', [deviceId]);
        const row = res.rows[0];
        return row ? deviceFromRow(row) : null;
      },
      async listByRuntime(runtimeId) {
        const res = await db.query<DeviceRow>('SELECT * FROM gateway_devices WHERE runtime_id = $1 ORDER BY paired_at, device_id', [runtimeId]);
        return res.rows.map(deviceFromRow);
      },
      async update(deviceId, patch) {
        const sets: string[] = [];
        const params: unknown[] = [deviceId];
        const set = (column: string, value: unknown) => {
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        };
        if (patch.name !== undefined) set('name', patch.name);
        if (patch.scopes !== undefined) set('scopes', [...patch.scopes]);
        if (patch.lastSeenAt !== undefined) set('last_seen_at', patch.lastSeenAt);
        if (patch.revoked !== undefined) set('revoked', patch.revoked);
        if (patch.revokedAt !== undefined) set('revoked_at', patch.revokedAt);
        const res =
          sets.length === 0
            ? await db.query<DeviceRow>('SELECT * FROM gateway_devices WHERE device_id = $1', params)
            : await db.query<DeviceRow>(`UPDATE gateway_devices SET ${sets.join(', ')} WHERE device_id = $1 RETURNING *`, params);
        const row = res.rows[0];
        return row ? deviceFromRow(row) : null;
      },
    },
    pairingCodes: {
      async create(p) {
        await db.query(
          `INSERT INTO gateway_pairing_codes (id, code, nonce, runtime_id, created_at, expires_at, used_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.id, p.code, p.nonce, p.runtimeId, p.createdAt, p.expiresAt, p.usedAt],
        );
      },
      async hasActive(code, now) {
        const res = await db.query(
          'SELECT 1 FROM gateway_pairing_codes WHERE code = $1 AND used_at IS NULL AND expires_at > $2 LIMIT 1',
          [code, at(now)],
        );
        return res.rows.length > 0;
      },
      async consume(code, now) {
        /* The outer `used_at IS NULL` is re-checked after a concurrent consumer commits: only one wins. */
        const res = await db.query<PairingRow>(
          `UPDATE gateway_pairing_codes SET used_at = $2
           WHERE id = (
             SELECT id FROM gateway_pairing_codes
             WHERE code = $1 AND used_at IS NULL AND expires_at > $2
             ORDER BY created_at, id
             LIMIT 1
           ) AND used_at IS NULL
           RETURNING *`,
          [code, at(now)],
        );
        const row = res.rows[0];
        return row ? pairingFromRow(row) : null;
      },
      async prune(now) {
        await db.query('DELETE FROM gateway_pairing_codes WHERE used_at IS NOT NULL OR expires_at <= $1', [at(now)]);
      },
    },
    refreshTokens: {
      async create(t) {
        await db.query(
          `INSERT INTO gateway_refresh_tokens (id, token_hash, device_id, runtime_id, family_id, created_at, expires_at, rotated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.id, t.tokenHash, t.deviceId, t.runtimeId, t.familyId, t.createdAt, t.expiresAt, t.rotatedAt],
        );
      },
      async findByHash(tokenHash) {
        const res = await db.query<RefreshRow>('SELECT * FROM gateway_refresh_tokens WHERE token_hash = $1', [tokenHash]);
        const row = res.rows[0];
        return row ? refreshFromRow(row) : null;
      },
      async markRotated(id, rotatedAt) {
        const res = await db.query('UPDATE gateway_refresh_tokens SET rotated_at = $2 WHERE id = $1 AND rotated_at IS NULL', [id, rotatedAt]);
        return res.rowCount === 1;
      },
      async deleteByDevice(deviceId) {
        const res = await db.query('DELETE FROM gateway_refresh_tokens WHERE device_id = $1', [deviceId]);
        return res.rowCount;
      },
      async prune(now) {
        await db.query('DELETE FROM gateway_refresh_tokens WHERE expires_at <= $1', [at(now)]);
      },
    },
    audit: {
      async append(e) {
        await db.query(
          'INSERT INTO gateway_audit (id, at, actor, action, target, ok, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [e.id, e.at, e.actor, e.action, e.target, e.ok, e.detail],
        );
      },
      async list(opts = {}) {
        const where: string[] = [];
        const params: unknown[] = [];
        if (opts.actor !== undefined) {
          params.push(opts.actor);
          where.push(`actor = $${params.length}`);
        }
        if (opts.action !== undefined) {
          params.push(opts.action);
          where.push(`action = $${params.length}`);
        }
        params.push(opts.limit ?? 100);
        const res = await db.query<AuditRow>(
          `SELECT * FROM (
             SELECT * FROM gateway_audit ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY seq DESC LIMIT $${params.length}
           ) latest ORDER BY seq`,
          params,
        );
        return res.rows.map(auditFromRow);
      },
      async prune(before) {
        await db.query('DELETE FROM gateway_audit WHERE at < $1', [before]);
      },
    },
    close: () => db.close(),
  };
}
