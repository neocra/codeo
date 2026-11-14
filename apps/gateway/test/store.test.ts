import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceRecord, GatewayStore, PairingCodeRecord, RefreshTokenRecord } from '../src/store';
import { createTestStore, TEST_STORE_KIND } from './helpers';

/* The store contract, run on the in-memory store and on PostgreSQL (see vitest.config.ts). */

const T0 = Date.UTC(2026, 0, 1);
const iso = (ms: number) => new Date(ms).toISOString();

let store: GatewayStore;
beforeEach(async () => {
  store = await createTestStore();
  await store.runtimes.create({
    runtimeId: 'rt_1',
    name: 'mac',
    platform: 'darwin',
    ownerAccountId: 'acc_1',
    runtimeSecretHash: 'a'.repeat(64),
    createdAt: iso(T0),
    lastSeenAt: null,
  });
});
afterEach(async () => {
  await store.close();
});

const device = (deviceId: string, over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  deviceId,
  runtimeId: 'rt_1',
  accountId: 'acc_1',
  name: 'iPhone',
  platform: 'ios',
  publicKey: null,
  scopes: ['read', 'session:write'],
  pairedAt: iso(T0),
  lastSeenAt: null,
  revoked: false,
  revokedAt: null,
  ...over,
});

const code = (id: string, over: Partial<PairingCodeRecord> = {}): PairingCodeRecord => ({
  id,
  code: '123456',
  nonce: `nonce-${id}`,
  runtimeId: 'rt_1',
  createdAt: iso(T0),
  expiresAt: iso(T0 + 300_000),
  usedAt: null,
  ...over,
});

const token = (id: string, over: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord => ({
  id,
  tokenHash: `hash-${id}`,
  deviceId: 'dev_1',
  runtimeId: 'rt_1',
  familyId: 'fam_1',
  createdAt: iso(T0),
  expiresAt: iso(T0 + 3_600_000),
  rotatedAt: null,
  ...over,
});

describe(`gateway store contract (${TEST_STORE_KIND})`, () => {
  it('runtimes: create, read back exactly, touch, refuse a duplicate id', async () => {
    expect(await store.runtimes.get('rt_1')).toEqual({
      runtimeId: 'rt_1',
      name: 'mac',
      platform: 'darwin',
      ownerAccountId: 'acc_1',
      runtimeSecretHash: 'a'.repeat(64),
      createdAt: iso(T0),
      lastSeenAt: null,
    });
    await store.runtimes.touch('rt_1', iso(T0 + 5000));
    expect((await store.runtimes.get('rt_1'))?.lastSeenAt).toBe(iso(T0 + 5000));
    expect(await store.runtimes.get('rt_missing')).toBeNull();
    await expect(
      store.runtimes.create({ runtimeId: 'rt_1', name: 'x', platform: 'x', ownerAccountId: 'x', runtimeSecretHash: 'x', createdAt: iso(T0), lastSeenAt: null }),
    ).rejects.toThrow();
  });

  it('devices: scopes and patches round-trip; returned records are copies', async () => {
    await store.devices.create(device('dev_1', { publicKey: 'pk' }));
    await store.devices.create(device('dev_2', { pairedAt: iso(T0 + 1000), platform: 'android' }));
    const got = await store.devices.get('dev_1');
    expect(got).toEqual(device('dev_1', { publicKey: 'pk' }));
    got?.scopes.push('workspace:admin');
    expect((await store.devices.get('dev_1'))?.scopes).toEqual(['read', 'session:write']);

    const updated = await store.devices.update('dev_1', { scopes: ['read'], revoked: true, revokedAt: iso(T0 + 2000), lastSeenAt: iso(T0 + 1500) });
    expect(updated).toMatchObject({ scopes: ['read'], revoked: true, revokedAt: iso(T0 + 2000), lastSeenAt: iso(T0 + 1500), name: 'iPhone' });
    expect(await store.devices.update('dev_1', {})).toEqual(updated);
    expect(await store.devices.update('dev_missing', { name: 'x' })).toBeNull();

    const list = await store.devices.listByRuntime('rt_1');
    expect(list.map((d) => d.deviceId).sort()).toEqual(['dev_1', 'dev_2']);
    expect(await store.devices.listByRuntime('rt_other')).toEqual([]);
  });

  it('pairing codes: single use, expiry, and only one of concurrent consumers wins', async () => {
    await store.pairingCodes.create(code('pc_1'));
    expect(await store.pairingCodes.hasActive('123456', T0)).toBe(true);
    expect(await store.pairingCodes.hasActive('123456', T0 + 300_000)).toBe(false);
    expect(await store.pairingCodes.consume('123456', T0 + 300_000)).toBeNull();

    const results = await Promise.all([1, 2, 3, 4].map(() => store.pairingCodes.consume('123456', T0 + 1000)));
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ id: 'pc_1', nonce: 'nonce-pc_1', usedAt: iso(T0 + 1000) });
    expect(await store.pairingCodes.hasActive('123456', T0 + 1000)).toBe(false);
    expect(await store.pairingCodes.consume('123456', T0 + 1000)).toBeNull();
  });

  it('pairing codes: prune drops used and expired codes only', async () => {
    await store.pairingCodes.create(code('pc_used', { code: '111111' }));
    await store.pairingCodes.create(code('pc_old', { code: '222222', expiresAt: iso(T0 + 10) }));
    await store.pairingCodes.create(code('pc_live', { code: '333333' }));
    await store.pairingCodes.consume('111111', T0 + 1);
    await store.pairingCodes.prune(T0 + 100);
    expect(await store.pairingCodes.consume('333333', T0 + 100)).toMatchObject({ id: 'pc_live' });
    expect(await store.pairingCodes.hasActive('222222', T0)).toBe(false);
  });

  it('refresh tokens: rotation succeeds once, even when raced', async () => {
    await store.devices.create(device('dev_1'));
    await store.refreshTokens.create(token('rft_1'));
    expect(await store.refreshTokens.findByHash('hash-rft_1')).toEqual(token('rft_1'));
    expect(await store.refreshTokens.findByHash('hash-missing')).toBeNull();

    const raced = await Promise.all([1, 2, 3].map(() => store.refreshTokens.markRotated('rft_1', iso(T0 + 1))));
    expect(raced.filter(Boolean)).toHaveLength(1);
    expect((await store.refreshTokens.findByHash('hash-rft_1'))?.rotatedAt).toBe(iso(T0 + 1));
    expect(await store.refreshTokens.markRotated('rft_missing', iso(T0))).toBe(false);
  });

  it('refresh tokens: delete by device, prune expired', async () => {
    await store.devices.create(device('dev_1'));
    await store.devices.create(device('dev_2'));
    await store.refreshTokens.create(token('rft_1'));
    await store.refreshTokens.create(token('rft_2'));
    await store.refreshTokens.create(token('rft_3', { deviceId: 'dev_2', expiresAt: iso(T0 + 10) }));
    await store.refreshTokens.create(token('rft_4', { deviceId: 'dev_2' }));
    expect(await store.refreshTokens.deleteByDevice('dev_1')).toBe(2);
    expect(await store.refreshTokens.deleteByDevice('dev_1')).toBe(0);
    await store.refreshTokens.prune(T0 + 100);
    expect(await store.refreshTokens.findByHash('hash-rft_3')).toBeNull();
    expect(await store.refreshTokens.findByHash('hash-rft_4')).not.toBeNull();
  });

  it('push tokens: upsert per device, a token moves to the newest device, revoked devices are not listed', async () => {
    await store.devices.create(device('dev_1'));
    await store.devices.create(device('dev_2'));
    const push = (deviceId: string, token: string) => ({
      deviceId,
      runtimeId: 'rt_1',
      provider: 'apns' as const,
      token,
      environment: 'sandbox' as const,
      locale: 'en' as const,
      updatedAt: iso(T0),
    });
    await store.pushTokens.upsert(push('dev_1', 'a'.repeat(64)));
    expect(await store.pushTokens.get('dev_1')).toEqual(push('dev_1', 'a'.repeat(64)));
    await store.pushTokens.upsert({ ...push('dev_1', 'b'.repeat(64)), locale: 'fr' });
    expect((await store.pushTokens.get('dev_1'))?.token).toBe('b'.repeat(64));
    expect((await store.pushTokens.get('dev_1'))?.locale).toBe('fr');

    /* The phone paired again: its token now belongs to the new device only. */
    await store.pushTokens.upsert(push('dev_2', 'b'.repeat(64)));
    expect(await store.pushTokens.get('dev_1')).toBeNull();
    expect((await store.pushTokens.listByRuntime('rt_1')).map((p) => p.deviceId)).toEqual(['dev_2']);

    await store.pushTokens.upsert(push('dev_1', 'c'.repeat(64)));
    await store.devices.update('dev_2', { revoked: true, revokedAt: iso(T0) });
    expect((await store.pushTokens.listByRuntime('rt_1')).map((p) => p.deviceId)).toEqual(['dev_1']);
    expect(await store.pushTokens.listByRuntime('rt_other')).toEqual([]);

    expect(await store.pushTokens.delete('dev_1')).toBe(true);
    expect(await store.pushTokens.delete('dev_1')).toBe(false);
  });

  it('audit: oldest first, limit keeps the latest, filters, prune by age', async () => {
    for (let i = 0; i < 5; i++) {
      await store.audit.append({ id: `aud_${i}`, at: iso(T0 + i * 1000), actor: i % 2 ? 'device:d' : 'runtime:r', action: i < 3 ? 'a' : 'b', target: null, ok: true, detail: i === 0 ? null : `n=${i}` });
    }
    expect((await store.audit.list()).map((e) => e.id)).toEqual(['aud_0', 'aud_1', 'aud_2', 'aud_3', 'aud_4']);
    expect((await store.audit.list({ limit: 2 })).map((e) => e.id)).toEqual(['aud_3', 'aud_4']);
    expect((await store.audit.list({ actor: 'device:d' })).map((e) => e.id)).toEqual(['aud_1', 'aud_3']);
    expect((await store.audit.list({ actor: 'runtime:r', action: 'a' })).map((e) => e.id)).toEqual(['aud_0', 'aud_2']);
    expect((await store.audit.list({ limit: 1 }))[0]).toEqual({ id: 'aud_4', at: iso(T0 + 4000), actor: 'runtime:r', action: 'b', target: null, ok: true, detail: 'n=4' });
    await store.audit.prune(iso(T0 + 2000));
    expect((await store.audit.list()).map((e) => e.id)).toEqual(['aud_2', 'aud_3', 'aud_4']);
  });
});
