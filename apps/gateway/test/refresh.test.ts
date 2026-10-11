import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, pairDevice, registerRuntime, type TestContext } from './helpers';

let ctx: TestContext;
let runtimeSecret: string;

beforeAll(async () => {
  ctx = await createTestApp();
  ({ runtimeSecret } = await registerRuntime(ctx));
});
afterAll(async () => {
  await ctx.app.close();
});

const refresh = (refreshToken: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

interface Creds {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}

describe('refresh token rotation', () => {
  it('rotates: a new pair is issued and the old refresh token is retired', async () => {
    const paired = await pairDevice(ctx, runtimeSecret);
    ctx.clock.advance(1000);
    const res = await refresh(paired.refreshToken);
    expect(res.statusCode).toBe(200);
    const next = res.json<Creds>();
    expect(next.deviceId).toBe(paired.deviceId);
    expect(next.refreshToken).not.toBe(paired.refreshToken);
    expect(next.accessToken).not.toBe(paired.accessToken);
    expect(ctx.tokens.verifyAccessToken(next.accessToken, ctx.clock.now()).ok).toBe(true);

    /* The new token keeps working. */
    const res2 = await refresh(next.refreshToken);
    expect(res2.statusCode).toBe(200);
  });

  it('reuse of a rotated token revokes the whole device (replay protection)', async () => {
    const paired = await pairDevice(ctx, runtimeSecret, 'Pixel');
    const rotated = (await refresh(paired.refreshToken)).json<Creds>();

    /* Replay the token that was just rotated. */
    const replay = await refresh(paired.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(replay.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');

    const device = await ctx.store.devices.get(paired.deviceId);
    expect(device?.revoked).toBe(true);

    /* The legitimate successor is dead too: the family is burnt. */
    expect((await refresh(rotated.refreshToken)).statusCode).toBe(401);

    /* And the still-valid access token is refused at the edge. */
    await expect(ctx.auth.verifyDeviceToken(rotated.accessToken)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

    const audit = await ctx.store.audit.list({ action: 'auth.refresh.reuse' });
    expect(audit.at(-1)).toMatchObject({ ok: false, target: paired.deviceId });
  });

  it('rejects unknown and expired refresh tokens', async () => {
    expect((await refresh('rft_' + 'x'.repeat(40))).statusCode).toBe(401);
    const paired = await pairDevice(ctx, runtimeSecret, 'Old phone');
    ctx.clock.advance(31 * 24 * 3600 * 1000);
    expect((await refresh(paired.refreshToken)).statusCode).toBe(401);
    const device = await ctx.store.devices.get(paired.deviceId);
    expect(device?.revoked).toBe(false);
  });

  it('validates the body', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'short' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('device revocation', () => {
  it('runtime can revoke its own device; other runtimes cannot see it', async () => {
    const paired = await pairDevice(ctx, runtimeSecret, 'Revoke me');
    const other = await registerRuntime(ctx);
    const foreign = await ctx.app.inject({ method: 'POST', url: `/v1/devices/${paired.deviceId}/revoke`, headers: { authorization: `Bearer ${other.runtimeSecret}` } });
    expect(foreign.statusCode).toBe(404);

    const res = await ctx.app.inject({ method: 'POST', url: `/v1/devices/${paired.deviceId}/revoke`, headers: { authorization: `Bearer ${runtimeSecret}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ revoked: boolean }>().revoked).toBe(true);
    expect((await refresh(paired.refreshToken)).statusCode).toBe(401);
    await expect(ctx.auth.verifyDeviceToken(paired.accessToken)).rejects.toMatchObject({ status: 403 });
  });
});
