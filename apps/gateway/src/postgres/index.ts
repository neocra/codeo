import type { Logger } from '@codeo/shared-utils';
import type { GatewayStore } from '../store';
import { createPgDatabase, describeConnectionString, type SqlDatabase } from './db';
import { migrate } from './migrations';
import { createPostgresStore } from './store';

export { createPgDatabase, describeConnectionString, type SqlClient, type SqlDatabase, type SqlResult } from './db';
export { migrate, MIGRATIONS } from './migrations';
export { createPostgresStore } from './store';

/** Migrates `db` and returns the store on it; the database is closed when migration fails. */
export async function openPostgresStore(db: SqlDatabase, log: Logger): Promise<GatewayStore> {
  try {
    const applied = await migrate(db);
    if (applied.length > 0) log.info('database migrated', { applied });
    return createPostgresStore(db);
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }
}

/** Connects to PostgreSQL with the pool from `pg`. */
export async function connectPostgresStore(database: { url: string; poolSize: number }, log: Logger): Promise<GatewayStore> {
  const db = createPgDatabase({
    connectionString: database.url,
    max: database.poolSize,
    onError: (err) => log.warn('idle database connection failed', { err: err.message }),
  });
  log.info('using PostgreSQL store', { database: describeConnectionString(database.url) });
  return openPostgresStore(db, log);
}
