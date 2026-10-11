import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Database = LibSQLDatabase<typeof schema>;

export interface OpenDatabaseOptions {
  /** Absolute file path, or ':memory:' for tests. */
  file: string;
  /** Override the migrations folder (defaults to the package's `migrations/`). */
  migrationsFolder?: string;
}

export interface OpenedDatabase {
  db: Database;
  client: Client;
  close(): void;
}

/** Source layout: `packages/database/migrations`; bundled runtime: `dist/migrations` next to the entry file. */
export function defaultMigrationsFolder(): string {
  const env = process.env['CODEO_MIGRATIONS_DIR'];
  if (env && existsSync(env)) return env;
  for (const rel of ['./migrations', '../migrations']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path.join(p, 'meta', '_journal.json'))) return p;
  }
  throw new Error('Codeo database migrations folder not found');
}

export async function openDatabase(opts: OpenDatabaseOptions): Promise<OpenedDatabase> {
  const url = opts.file === ':memory:' ? ':memory:' : `file:${opts.file}`;
  if (opts.file !== ':memory:') mkdirSync(path.dirname(opts.file), { recursive: true });
  const client = createClient({ url });
  if (opts.file !== ':memory:') {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: opts.migrationsFolder ?? defaultMigrationsFolder() });
  return { db, client, close: () => client.close() };
}

export { schema };
