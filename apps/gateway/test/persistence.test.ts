import { describe, expect, it } from 'vitest';
import { createLogger } from '@codeo/shared-utils';
import { loadConfig } from '../src/config';
import { describeConnectionString, migrate, MIGRATIONS, openPostgresStore } from '../src/postgres';
import { connectWs, createTestApp, fakeClock, pairDevice, registerRuntime, TEST_STORE_KIND, type TestContext } from './helpers';
import { createPgliteDatabase, createReusablePgliteDatabase } from './pglite';

const silent = createLogger({ level: 'error', sink: () => undefined });

/* These suites build their PostgreSQL stores themselves: run them once, in the postgres project. */
const pgOnly = describe.skipIf(TEST_STORE_KIND !== 'postgres');

/* What the PostgreSQL store is for: a gateway restart keeps runtimes, phones and their tokens. */
pgOnly('gateway restart on the PostgreSQL store', () => {
  it('keeps registrations, paired phones, refresh tokens, pending codes and the audit trail', async () => {
    const { db, destroy } = await createReusablePgliteDatabase();
    const clock = fakeClock();
    try {
      let ctx: TestContext = await createTestApp({}, { store: await openPostgresStore(db, silent), clock });
      const { runtimeId, runtimeSecret } = await registerRuntime(ctx);
      const phone = await pairDevice(ctx, runtimeSecret);
      const pending = await ctx.app.inject({ method: 'POST', url: '/v1/pairing/start', headers: { authorization: `Bearer ${runtimeSecret}` } });
      const pendingCode = pending.json<{ code: string }>().code;
      await ctx.app.close();

      /* Same database, same GATEWAY_SECRET, new process. Migrations run again and change nothing. */
      ctx = await createTestApp({}, { store: await openPostgresStore(db, silent), clock });
      try {
        const devices = await ctx.app.inject({ method: 'GET', url: '/v1/devices', headers: { authorization: `Bearer ${runtimeSecret}` } });
        expect(devices.statusCode).toBe(200);
        expect(JSON.stringify(devices.json())).toContain(phone.deviceId);

        /* The phone's access token is still accepted by the relay (runtime is offline: 4004 after upgrade). */
        const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
        const { ws } = await connectWs(`${address.replace('http', 'ws')}/v1/devices/connect`, phone.accessToken);
        ws.close();

        clock.advance(1000);
        const refreshed = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: phone.refreshToken } });
        expect(refreshed.statusCode).toBe(200);
        expect(refreshed.json<{ deviceId: string; runtimeId: string }>()).toMatchObject({ deviceId: phone.deviceId, runtimeId });

        /* Pairing still works, a code started before the restart is still single use, and the retired token is known: replaying it revokes the phone. */
        const second = await pairDevice(ctx, runtimeSecret, 'iPad');
        expect(second.deviceId).not.toBe(phone.deviceId);
        const completed = await ctx.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code: pendingCode, device: { name: 'Pixel', platform: 'android' } } });
        expect(completed.statusCode).toBe(201);
        const reused = await ctx.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code: pendingCode, device: { name: 'Pixel', platform: 'android' } } });
        expect(reused.statusCode).toBe(404);

        const replay = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: phone.refreshToken } });
        expect(replay.statusCode).toBe(401);
        expect((await ctx.store.devices.get(phone.deviceId))?.revoked).toBe(true);

        const audit = await ctx.store.audit.list({ action: 'pairing.complete' });
        expect(audit.length).toBeGreaterThanOrEqual(3);
      } finally {
        await ctx.app.close();
      }
    } finally {
      await destroy();
    }
  });

  it('two concurrent refreshes with one token: one succeeds, the other is treated as a replay', async () => {
    const ctx = await createTestApp({}, { store: await openPostgresStore(await createPgliteDatabase(), silent) });
    try {
      const { runtimeSecret } = await registerRuntime(ctx);
      const phone = await pairDevice(ctx, runtimeSecret);
      const results = await Promise.all(
        [1, 2].map(() => ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: phone.refreshToken } })),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
      expect((await ctx.store.devices.get(phone.deviceId))?.revoked).toBe(true);
    } finally {
      await ctx.app.close();
    }
  });
});

pgOnly('migrations', () => {
  it('apply once, record their version, and refuse a database from a newer gateway', async () => {
    const db = await createPgliteDatabase();
    try {
      expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
      expect(await migrate(db)).toEqual([]);
      const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
      await db.query('INSERT INTO gateway_schema_migrations (version, name) VALUES ($1, $2)', [latest + 1, 'future']);
      await expect(migrate(db)).rejects.toThrow(/newer than this gateway/);
    } finally {
      await db.close();
    }
  });
});

pgOnly('database configuration', () => {
  const base = { GATEWAY_SECRET: 'x'.repeat(40) };

  it('production requires DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'https://gw.example.com' })).toThrow(/DATABASE_URL is required/);
    const config = loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'https://gw.example.com', DATABASE_URL: 'postgres://u:p@db/gw' });
    expect(config.database).toEqual({ url: 'postgres://u:p@db/gw', poolSize: 10 });
  });

  it('development falls back to memory with a warning; other URLs are refused', () => {
    const warnings: string[] = [];
    expect(loadConfig({ ...base, NODE_ENV: 'development' }, { warn: (m) => warnings.push(m) }).database).toBeNull();
    expect(warnings.some((w) => w.includes('in-memory store'))).toBe(true);
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://db/gw' })).toThrow(/postgres:\/\//);
  });

  it('never prints the database password', () => {
    expect(describeConnectionString('postgres://gateway:s3cret@db.internal:5432/gw?sslmode=require')).toBe(
      'postgres://gateway:***@db.internal:5432/gw?sslmode=require',
    );
  });
});
