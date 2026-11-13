import { PGlite } from '@electric-sql/pglite';
import type { SqlClient, SqlDatabase } from '../src/postgres';

/*
 * PGlite is PostgreSQL compiled to WASM, in process: the PostgreSQL store runs its real SQL in tests
 * without a server. One connection, so it cannot exercise contention between processes.
 */

interface PgliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
  exec(text: string): Promise<{ rows: unknown[]; affectedRows?: number }[]>;
}

function wrap(db: PgliteLike): SqlClient {
  return {
    async query<R>(text: string, params: readonly unknown[] = []) {
      if (params.length === 0) {
        /* Simple protocol: allows several statements (migrations). */
        const results = await db.exec(text);
        const last = results[results.length - 1];
        return { rows: (last?.rows ?? []) as R[], rowCount: last?.affectedRows ?? 0 };
      }
      const res = await db.query<R>(text, [...params]);
      return { rows: res.rows, rowCount: res.affectedRows ?? 0 };
    },
  };
}

export async function createPgliteDatabase(): Promise<SqlDatabase> {
  const db = await PGlite.create();
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    async close() {
      if (!db.closed) await db.close();
    },
  };
}

/** Same as createPgliteDatabase, with `close` left to the caller (to rebuild a gateway on the same data). */
export async function createReusablePgliteDatabase(): Promise<{ db: SqlDatabase; destroy: () => Promise<void> }> {
  const db = await createPgliteDatabase();
  return { db: { ...db, close: async () => undefined }, destroy: () => db.close() };
}
