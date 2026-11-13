import type { SqlDatabase } from './db';

/*
 * Schema migrations, applied in order at boot. Never edit a released migration: append a new one.
 * Timestamps are timestamptz (compared in SQL), ids are the gateway's own prefixed strings.
 */
export const MIGRATIONS: readonly { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE gateway_runtimes (
        runtime_id text PRIMARY KEY,
        name text NOT NULL,
        platform text NOT NULL,
        owner_account_id text NOT NULL,
        runtime_secret_hash text NOT NULL,
        created_at timestamptz NOT NULL,
        last_seen_at timestamptz
      );

      CREATE TABLE gateway_devices (
        device_id text PRIMARY KEY,
        runtime_id text NOT NULL REFERENCES gateway_runtimes (runtime_id) ON DELETE CASCADE,
        account_id text NOT NULL,
        name text NOT NULL,
        platform text NOT NULL CHECK (platform IN ('ios', 'android')),
        public_key text,
        scopes text[] NOT NULL,
        paired_at timestamptz NOT NULL,
        last_seen_at timestamptz,
        revoked boolean NOT NULL DEFAULT false,
        revoked_at timestamptz
      );
      CREATE INDEX gateway_devices_runtime_idx ON gateway_devices (runtime_id);

      CREATE TABLE gateway_pairing_codes (
        id text PRIMARY KEY,
        code text NOT NULL,
        nonce text NOT NULL,
        runtime_id text NOT NULL REFERENCES gateway_runtimes (runtime_id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX gateway_pairing_codes_active_idx ON gateway_pairing_codes (code) WHERE used_at IS NULL;

      CREATE TABLE gateway_refresh_tokens (
        id text PRIMARY KEY,
        token_hash text NOT NULL UNIQUE,
        device_id text NOT NULL REFERENCES gateway_devices (device_id) ON DELETE CASCADE,
        runtime_id text NOT NULL,
        family_id text NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        rotated_at timestamptz
      );
      CREATE INDEX gateway_refresh_tokens_device_idx ON gateway_refresh_tokens (device_id);
      CREATE INDEX gateway_refresh_tokens_expiry_idx ON gateway_refresh_tokens (expires_at);

      CREATE TABLE gateway_audit (
        seq bigserial PRIMARY KEY,
        id text NOT NULL UNIQUE,
        at timestamptz NOT NULL,
        actor text NOT NULL,
        action text NOT NULL,
        target text,
        ok boolean NOT NULL,
        detail text
      );
      CREATE INDEX gateway_audit_at_idx ON gateway_audit (at);
      CREATE INDEX gateway_audit_actor_idx ON gateway_audit (actor, seq);
      CREATE INDEX gateway_audit_action_idx ON gateway_audit (action, seq);
    `,
  },
];

/** Arbitrary constant: serializes migrations when several gateway processes boot at once. */
const MIGRATION_LOCK_KEY = 0x636f6465; // "code"

/**
 * Applies the migrations this database has not seen, each in its own transaction, under a
 * transaction-scoped advisory lock. Returns the versions applied. Refuses a database migrated by a
 * newer gateway (its schema is unknown to this build).
 */
export async function migrate(db: SqlDatabase): Promise<number[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gateway_schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    const done = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const seen = await tx.query<{ version: number }>('SELECT version FROM gateway_schema_migrations WHERE version = $1', [m.version]);
      if (seen.rows.length > 0) return false;
      await tx.query(m.sql);
      await tx.query('INSERT INTO gateway_schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
      return true;
    });
    if (done) applied.push(m.version);
  }
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  const max = await db.query<{ max: number | null }>('SELECT max(version) AS max FROM gateway_schema_migrations');
  const dbVersion = Number(max.rows[0]?.max ?? 0);
  if (dbVersion > latest) {
    throw new Error(`database schema version ${dbVersion} is newer than this gateway (${latest}); upgrade the gateway`);
  }
  return applied;
}
