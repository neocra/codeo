import pg from 'pg';

/*
 * The smallest SQL surface the PostgreSQL store needs. `pg.Pool` is adapted below; tests adapt PGlite
 * (an in-process PostgreSQL build) to the same shape, so the store runs the same SQL in both.
 */

export interface SqlResult<R> {
  rows: R[];
  /** Rows changed by INSERT / UPDATE / DELETE. */
  rowCount: number;
}

export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<SqlResult<R>>;
}

export interface SqlDatabase extends SqlClient {
  /** Runs `fn` on one connection inside BEGIN … COMMIT (ROLLBACK when it throws). */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PostgresOptions {
  connectionString: string;
  /** Pool size (default 10). */
  max?: number;
  /** Receives errors raised by idle pooled connections (otherwise they would crash the process). */
  onError?: (err: Error) => void;
}

export function createPgDatabase(opts: PostgresOptions): SqlDatabase {
  const pool = new pg.Pool({ connectionString: opts.connectionString, max: opts.max ?? 10, connectionTimeoutMillis: 10_000 });
  pool.on('error', (err) => opts.onError?.(err));

  const wrap = (client: pg.Pool | pg.PoolClient): SqlClient => ({
    async query<R>(text: string, params: readonly unknown[] = []) {
      const res = await client.query(text, [...params]);
      return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** `postgres://user:***@host/db`: never log a connection string as is. */
export function describeConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'postgres://(unparseable)';
  }
}
