import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerRuntime, type TestContext } from './helpers';

let ctx: TestContext;
let runtimeSecret: string;
let runtimeId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  ({ runtimeId, runtimeSecret } = await registerRuntime(ctx));
});
afterAll(async () => {
  await ctx.app.close();
});

const startPairing = (secret = runtimeSecret) =>
  ctx.app.inject({ method: 'POST', url: '/v1/pairing/start', headers: { authorization: `Bearer ${secret}` } });

const complete = (code: string, extra: Record<string, unknown> = {}) =>
  ctx.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code, device: { name: 'iPhone', platform: 'ios' }, ...extra } });

describe('runtime registration', () => {
  it('returns the secret once and never exposes it again', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/runtimes/register', payload: { name: 'laptop', platform: 'linux' } });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ runtimeId: string; runtimeSecret: string; ownerAccountId: string }>();
    expect(body.runtimeId.startsWith('rt_')).toBe(true);
    expect(body.runtimeSecret.startsWith(`${body.runtimeId}.`)).toBe(true);
    const stored = await ctx.store.runtimes.get(body.runtimeId);
    expect(stored?.runtimeSecretHash).toBeDefined();
    expect(stored?.runtimeSecretHash).not.toContain(body.runtimeSecret.split('.')[1]);
  });

  it('validates the body', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/runtimes/register', payload: { name: '', platform: 'amiga' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_PARAMS');
  });
});

describe('pairing flow', () => {
  it('requires runtime authentication to start', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/pairing/start' })).statusCode).toBe(401);
    expect((await startPairing(`${runtimeId}.wrong-secret`)).statusCode).toBe(401);
    expect((await startPairing('rt_unknown.whatever')).statusCode).toBe(401);
  });

  it('start → complete issues device credentials with the default scopes', async () => {
    const start = await startPairing();
    expect(start.statusCode).toBe(201);
    const { code, expiresAt, qrPayload } = start.json<{ code: string; expiresAt: string; qrPayload: string }>();
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt)).toBe(ctx.clock.now() + 300_000);
    const qr = JSON.parse(qrPayload) as { v: number; gateway: string; code: string; runtimeId: string; nonce: string };
    expect(qr).toMatchObject({ v: 1, gateway: 'https://gateway.test', code, runtimeId });
    expect(qr.nonce.length).toBeGreaterThan(8);

    const done = await complete(code, { nonce: qr.nonce, runtimeId: qr.runtimeId, publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-fake' });
    expect(done.statusCode).toBe(201);
    const body = done.json<{ accessToken: string; refreshToken: string; scopes: string[]; runtimeId: string; deviceId: string }>();
    expect(body.runtimeId).toBe(runtimeId);
    expect(body.scopes).toEqual(['read', 'session:write', 'approval:decide']);
    expect(body.accessToken.startsWith('v1.')).toBe(true);
    expect(body.refreshToken.startsWith('rft_')).toBe(true);
    expect(ctx.tokens.verifyAccessToken(body.accessToken, ctx.clock.now()).ok).toBe(true);

    const list = await ctx.app.inject({ method: 'GET', url: '/v1/devices', headers: { authorization: `Bearer ${runtimeSecret}` } });
    expect(list.statusCode).toBe(200);
    const devices = list.json<{ devices: { deviceId: string; revoked: boolean; connected: boolean }[] }>().devices;
    expect(devices.some((d) => d.deviceId === body.deviceId && !d.revoked && !d.connected)).toBe(true);
    expect(JSON.stringify(devices)).not.toContain('rft_');

    const audit = await ctx.store.audit.list({ action: 'pairing.complete' });
    expect(audit.at(-1)?.ok).toBe(true);
  });

  it('codes are single use', async () => {
    const { code } = (await startPairing()).json<{ code: string }>();
    expect((await complete(code)).statusCode).toBe(201);
    const again = await complete(code);
    expect(again.statusCode).toBe(404);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('a QR nonce mismatch burns the code', async () => {
    const { code } = (await startPairing()).json<{ code: string }>();
    expect((await complete(code, { nonce: 'definitely-not-the-nonce' })).statusCode).toBe(404);
    expect((await complete(code)).statusCode).toBe(404);
  });

  it('codes expire', async () => {
    const { code } = (await startPairing()).json<{ code: string }>();
    ctx.clock.advance(300_001);
    expect((await complete(code)).statusCode).toBe(404);
  });

  it('rejects malformed completion bodies', async () => {
    expect((await complete('12345')).statusCode).toBe(400);
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code: '123456', device: { name: 'x', platform: 'windows-phone' } } });
    expect(res.statusCode).toBe(400);
  });

  it('rate limits completion attempts per IP', async () => {
    const limited = await createTestApp();
    try {
      let last = 0;
      for (let i = 0; i < 11; i++) {
        const res = await limited.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code: '000000', device: { name: 'x', platform: 'android' } } });
        last = res.statusCode;
      }
      expect(last).toBe(429);
      limited.clock.advance(5 * 60_000 + 1);
      const after = await limited.app.inject({ method: 'POST', url: '/v1/pairing/complete', payload: { code: '000000', device: { name: 'x', platform: 'android' } } });
      expect(after.statusCode).toBe(404);
    } finally {
      await limited.app.close();
    }
  });
});
