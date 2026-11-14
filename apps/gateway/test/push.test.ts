import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { loadConfig } from '../src/config';
import { createApnsSender, createFcmSender, type ApnsRequest, type PushMessage, type PushResult, type PushSender } from '../src/push';
import type { PushTokenRecord } from '../src/store';
import { connectWs, createTestApp, pairDevice, registerRuntime, sampleRuntimeInfo, send, type TestContext } from './helpers';

const APNS_TOKEN = 'ab'.repeat(32);
const FCM_TOKEN = `fcm-token:${'x'.repeat(60)}`;

/** Records what would have been sent; answers with `result`. */
function fakeSender(provider: 'apns' | 'fcm', result: PushResult = { ok: true }) {
  const sent: { target: PushTokenRecord; message: PushMessage }[] = [];
  const sender: PushSender & { sent: typeof sent; result: PushResult } = {
    provider,
    sent,
    result,
    async send(target, message) {
      sent.push({ target, message });
      return sender.result;
    },
    async close() {},
  };
  return sender;
}

const apnsBody = { provider: 'apns', token: APNS_TOKEN, environment: 'sandbox', locale: 'en' };

let ctx: TestContext | null = null;
afterEach(async () => {
  await ctx?.app.close();
  ctx = null;
});

describe('push registration', () => {
  it('stores the token of an authenticated phone and says whether this gateway can deliver', async () => {
    ctx = await createTestApp();
    const { runtimeSecret } = await registerRuntime(ctx);
    const phone = await pairDevice(ctx, runtimeSecret);
    const auth = { authorization: `Bearer ${phone.accessToken}` };

    const res = await ctx.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: auth, payload: apnsBody });
    expect(res.statusCode).toBe(200);
    /* No APNs credentials on this gateway: reported, never faked. */
    expect(res.json()).toEqual({ provider: 'apns', delivery: 'unconfigured' });
    expect(await ctx.store.pushTokens.get(phone.deviceId)).toMatchObject({ provider: 'apns', token: APNS_TOKEN, environment: 'sandbox', locale: 'en' });
    expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ push: [] });

    const del = await ctx.app.inject({ method: 'DELETE', url: '/v1/devices/me/push', headers: auth });
    expect(del.json()).toEqual({ removed: true });
    expect(await ctx.store.pushTokens.get(phone.deviceId)).toBeNull();
  });

  it('reports delivery enabled when the provider is configured', async () => {
    ctx = await createTestApp({}, { pushSenders: { apns: fakeSender('apns') } });
    const { runtimeSecret } = await registerRuntime(ctx);
    const phone = await pairDevice(ctx, runtimeSecret);
    const res = await ctx.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: { authorization: `Bearer ${phone.accessToken}` }, payload: apnsBody });
    expect(res.json()).toEqual({ provider: 'apns', delivery: 'enabled' });
    expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ push: ['apns'] });
  });

  it('refuses unauthenticated calls, malformed tokens and a provider that does not match the platform', async () => {
    ctx = await createTestApp();
    const { runtimeSecret } = await registerRuntime(ctx);
    const iphone = await pairDevice(ctx, runtimeSecret);
    const pixel = await pairDevice(ctx, runtimeSecret, 'Pixel', 'android');

    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/devices/me/push', payload: apnsBody })).statusCode).toBe(401);
    /* A runtime secret is not a device credential. */
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: { authorization: `Bearer ${runtimeSecret}` }, payload: apnsBody })).statusCode).toBe(401);
    const put = (token: string, payload: object) =>
      ctx!.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: { authorization: `Bearer ${token}` }, payload });
    expect((await put(iphone.accessToken, { ...apnsBody, token: 'not-hex' })).statusCode).toBe(400);
    expect((await put(iphone.accessToken, { provider: 'fcm', token: FCM_TOKEN })).statusCode).toBe(400);
    expect((await put(pixel.accessToken, apnsBody)).statusCode).toBe(400);
    expect((await put(pixel.accessToken, { provider: 'fcm', token: FCM_TOKEN })).statusCode).toBe(200);
  });

  it('rate-limits registrations per device and per address, before authentication', async () => {
    ctx = await createTestApp();
    const { runtimeSecret } = await registerRuntime(ctx);
    const phone = await pairDevice(ctx, runtimeSecret);
    const put = (headers: Record<string, string>) => ctx!.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers, payload: apnsBody });
    for (let i = 0; i < 30; i++) expect((await put({ authorization: `Bearer ${phone.accessToken}` })).statusCode).toBe(200);
    expect((await put({ authorization: `Bearer ${phone.accessToken}` })).statusCode).toBe(429);
    /* Unauthenticated calls from one address stop before any token is checked. */
    for (let i = 0; i < 89; i++) await put({});
    expect((await put({})).statusCode).toBe(429);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/devices/me/push' })).statusCode).toBe(429);
  });

  it('forgets the token when the desktop revokes the phone', async () => {
    ctx = await createTestApp();
    const { runtimeSecret } = await registerRuntime(ctx);
    const phone = await pairDevice(ctx, runtimeSecret);
    await ctx.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: { authorization: `Bearer ${phone.accessToken}` }, payload: apnsBody });
    await ctx.app.inject({ method: 'POST', url: `/v1/devices/${phone.deviceId}/revoke`, headers: { authorization: `Bearer ${runtimeSecret}` } });
    await expect.poll(() => ctx!.store.pushTokens.get(phone.deviceId)).toBeNull();
  });
});

describe('push dispatch from runtime events', () => {
  const approval = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    sessionId: 'ses_1',
    taskId: null,
    workspaceId: 'ws_1',
    provider: 'claude-code',
    providerRequestId: 'toolu_1',
    tool: 'Bash',
    input: { command: 'rm -rf build' },
    summary: 'Exécuter `rm -rf build` in /Users/secret/project',
    affected: ['/Users/secret/project/build'],
    risk: 'high',
    reason: null,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:10:00.000Z',
    resolvedAt: null,
    decidedBy: null,
    ...over,
  });

  async function setup(apnsResult?: PushResult) {
    const apns = fakeSender('apns', apnsResult);
    const fcm = fakeSender('fcm');
    ctx = await createTestApp({}, { pushSenders: { apns, fcm } });
    const base = (await ctx.app.listen({ port: 0, host: '127.0.0.1' })).replace(/^http/, 'ws');
    const { runtimeId, runtimeSecret } = await registerRuntime(ctx);
    const iphone = await pairDevice(ctx, runtimeSecret);
    const pixel = await pairDevice(ctx, runtimeSecret, 'Pixel', 'android');
    const register = (token: string, payload: object) =>
      ctx!.app.inject({ method: 'PUT', url: '/v1/devices/me/push', headers: { authorization: `Bearer ${token}` }, payload });
    await register(iphone.accessToken, apnsBody);
    await register(pixel.accessToken, { provider: 'fcm', token: FCM_TOKEN, locale: 'fr' });

    const { ws, reader } = await connectWs(`${base}/v1/runtimes/${runtimeId}/connect`, runtimeSecret);
    await reader.next(); /* gateway hello */
    send(ws, { kind: 'welcome', runtime: sampleRuntimeInfo, lastSeq: 0, scopes: [] });
    let seq = 0;
    const emit = async (event: object) => {
      seq++;
      send(ws, { kind: 'event', seq, event: { id: `evt_${seq}`, at: '2026-01-01T00:00:00.000Z', ...event } });
      /* Frames are handled in order: once a ping round-trips, the event before it has been dispatched. */
      send(ws, { kind: 'pong', t: seq });
      await new Promise((r) => setTimeout(r, 30));
      await ctx!.push.idle();
    };
    return { apns, fcm, ws, emit, runtimeId, iphone, pixel };
  }

  let runtimeWs: WebSocket | null = null;
  afterEach(() => {
    runtimeWs?.close();
    runtimeWs = null;
  });

  it('sends one content-free push per pending approval to every phone, in its language', async () => {
    const s = await setup();
    runtimeWs = s.ws;
    await s.emit({ type: 'ApprovalRequested', approval: approval('apr_1') });

    expect(s.apns.sent).toHaveLength(1);
    expect(s.fcm.sent).toHaveLength(1);
    const ios = s.apns.sent[0]!;
    expect(ios.target.deviceId).toBe(s.iphone.deviceId);
    expect(ios.message).toEqual({
      kind: 'approval',
      runtimeId: s.runtimeId,
      approvalId: 'apr_1',
      title: 'Codeo',
      body: 'An approval is waiting for your decision.',
      expiresAt: Date.parse('2026-01-01T00:10:00.000Z'),
    });
    expect(s.fcm.sent[0]!.message.body).toBe('Une approbation attend votre décision.');
    /* Nothing of the approval itself leaves through the push providers. */
    const wire = JSON.stringify([...s.apns.sent, ...s.fcm.sent].map((x) => x.message));
    for (const secret of ['rm -rf', 'secret', 'Bash', 'toolu_1', 'ses_1']) expect(wire).not.toContain(secret);

    /* The same approval replayed after a relay reconnect is not pushed twice. */
    await s.emit({ type: 'ApprovalRequested', approval: approval('apr_1') });
    expect(s.apns.sent).toHaveLength(1);
    const audit = await ctx!.store.audit.list({ action: 'push.send' });
    expect(audit.filter((e) => e.ok)).toHaveLength(2);
  });

  it('ignores resolved and expired approvals and other events', async () => {
    const s = await setup();
    runtimeWs = s.ws;
    await s.emit({ type: 'ApprovalRequested', approval: approval('apr_2', { status: 'approved' }) });
    await s.emit({ type: 'ApprovalRequested', approval: approval('apr_3', { expiresAt: '2025-12-31T23:59:00.000Z' }) });
    await s.emit({ type: 'ApprovalResolved', approval: approval('apr_4', { status: 'rejected' }) });
    await s.emit({ type: 'RuntimeReady', version: '0.1.0' });
    expect(s.apns.sent).toHaveLength(0);
    expect(s.fcm.sent).toHaveLength(0);
  });

  it('skips phones that may not decide approvals and drops tokens the provider declares dead', async () => {
    const s = await setup({ ok: false, invalidToken: true, reason: 'Unregistered' });
    runtimeWs = s.ws;
    await ctx!.store.devices.update(s.pixel.deviceId, { scopes: ['read'] });
    await s.emit({ type: 'ApprovalRequested', approval: approval('apr_5') });
    expect(s.fcm.sent).toHaveLength(0);
    expect(s.apns.sent).toHaveLength(1);
    expect(await ctx!.store.pushTokens.get(s.iphone.deviceId)).toBeNull();
    expect(await ctx!.store.pushTokens.get(s.pixel.deviceId)).not.toBeNull();
  });
});

const target = (over: Partial<PushTokenRecord> = {}): PushTokenRecord => ({
  deviceId: 'dev_1',
  runtimeId: 'rt_1',
  provider: 'apns',
  token: APNS_TOKEN,
  environment: 'sandbox',
  locale: 'en',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const message: PushMessage = { kind: 'approval', runtimeId: 'rt_1', approvalId: 'apr_1', title: 'Codeo', body: 'An approval is waiting.', expiresAt: Date.UTC(2026, 0, 1, 0, 10) };

const decodeJwt = (jwt: string) => {
  const [h, c, sig] = jwt.split('.') as [string, string, string];
  return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(c, 'base64url').toString()), input: `${h}.${c}`, sig: Buffer.from(sig, 'base64url') };
};

describe('APNs sender', () => {
  it('posts an alert to the environment host with an ES256 provider token, and reuses the token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const requests: ApnsRequest[] = [];
    let now = Date.UTC(2026, 0, 1);
    const sender = createApnsSender({
      key: privateKey,
      keyId: 'KEY1234567',
      teamId: 'TEAM123456',
      topic: 'com.codeo.remote',
      now: () => now,
      transport: async (req) => {
        requests.push(req);
        return { status: 200, body: '' };
      },
    });
    expect(await sender.send(target(), message)).toEqual({ ok: true });
    const req = requests[0]!;
    expect(req.origin).toBe('https://api.sandbox.push.apple.com');
    expect(req.path).toBe(`/3/device/${APNS_TOKEN}`);
    expect(req.headers).toMatchObject({ 'apns-topic': 'com.codeo.remote', 'apns-push-type': 'alert', 'apns-collapse-id': 'apr_1', 'apns-expiration': String(message.expiresAt / 1000) });
    expect(JSON.parse(req.body)).toEqual({
      aps: { alert: { title: 'Codeo', body: 'An approval is waiting.' }, sound: 'default', 'thread-id': 'rt_1' },
      codeo: { type: 'approval', runtimeId: 'rt_1', approvalId: 'apr_1' },
    });
    const jwt = decodeJwt(req.headers.authorization!.replace(/^bearer /, ''));
    expect(jwt.header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'KEY1234567' });
    expect(jwt.claims).toEqual({ iss: 'TEAM123456', iat: now / 1000 });
    expect(verify('sha256', Buffer.from(jwt.input), { key: publicKey, dsaEncoding: 'ieee-p1363' }, jwt.sig)).toBe(true);

    now += 10 * 60_000;
    await sender.send(target({ environment: 'production' }), message);
    expect(requests[1]!.origin).toBe('https://api.push.apple.com');
    expect(requests[1]!.headers.authorization).toBe(req.headers.authorization);
    now += 45 * 60_000;
    await sender.send(target(), message);
    expect(requests[2]!.headers.authorization).not.toBe(req.headers.authorization);
  });

  it('tells a dead device token from other failures', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const answers = [
      { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) },
      { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) },
      { status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) },
      { status: 403, body: JSON.stringify({ reason: 'InvalidProviderToken' }) },
    ];
    const sender = createApnsSender({ key: privateKey, keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 't', transport: async () => answers.shift()! });
    expect(await sender.send(target(), message)).toEqual({ ok: false, invalidToken: true, reason: 'Unregistered' });
    expect(await sender.send(target(), message)).toEqual({ ok: false, invalidToken: true, reason: 'BadDeviceToken' });
    expect(await sender.send(target(), message)).toEqual({ ok: false, invalidToken: false, reason: 'TooManyRequests' });
    expect(await sender.send(target(), message)).toEqual({ ok: false, invalidToken: false, reason: 'InvalidProviderToken' });
  });
});

describe('FCM sender', () => {
  it('mints an OAuth token from the service account, then sends an HTTP v1 message', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const now = Date.UTC(2026, 0, 1);
    const sender = createFcmSender({
      projectId: 'codeo-remote',
      clientEmail: 'push@codeo-remote.iam.gserviceaccount.com',
      key: privateKey,
      tokenUri: 'https://oauth2.googleapis.com/token',
      now: () => now,
      transport: async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        if (url.includes('oauth2')) return { status: 200, body: JSON.stringify({ access_token: 'ya29.test', expires_in: 3599 }) };
        return { status: 200, body: '{}' };
      },
    });
    const fcmTarget = target({ provider: 'fcm', token: FCM_TOKEN, environment: 'production' });
    expect(await sender.send(fcmTarget, message)).toEqual({ ok: true });
    expect(await sender.send(fcmTarget, message)).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/codeo-remote/messages:send',
      'https://fcm.googleapis.com/v1/projects/codeo-remote/messages:send',
    ]);
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = decodeJwt(form.get('assertion')!);
    expect(jwt.header.alg).toBe('RS256');
    expect(jwt.claims).toMatchObject({ iss: 'push@codeo-remote.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' });
    expect(verify('sha256', Buffer.from(jwt.input), publicKey, jwt.sig)).toBe(true);
    expect(calls[1]!.headers.authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(calls[1]!.body)).toEqual({
      message: {
        token: FCM_TOKEN,
        notification: { title: 'Codeo', body: 'An approval is waiting.' },
        data: { type: 'approval', runtimeId: 'rt_1', approvalId: 'apr_1' },
        android: { priority: 'HIGH', ttl: '600s', collapse_key: 'apr_1', notification: { channel_id: 'approvals' } },
      },
    });
  });

  it('reports UNREGISTERED tokens as dead', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sender = createFcmSender({
      projectId: 'p',
      clientEmail: 'e@p',
      key: privateKey,
      tokenUri: 'https://oauth2.googleapis.com/token',
      transport: async (url) =>
        url.includes('oauth2')
          ? { status: 200, body: JSON.stringify({ access_token: 't', expires_in: 3600 }) }
          : { status: 404, body: JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) },
    });
    expect(await sender.send(target({ provider: 'fcm', token: FCM_TOKEN }), message)).toEqual({ ok: false, invalidToken: true, reason: 'UNREGISTERED' });
  });
});

describe('push configuration', () => {
  it('needs the three APNs settings together and leaves unconfigured providers off', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', APNS_KEY_PATH: '/k.p8' })).toThrow(/must be set together/);
    expect(loadConfig({ NODE_ENV: 'test' }).push).toEqual({ apns: null, fcm: null });
    expect(loadConfig({ NODE_ENV: 'test', APNS_KEY_PATH: '/k.p8', APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456' }).push.apns).toEqual({
      keyPath: '/k.p8',
      keyId: 'KEY1234567',
      teamId: 'TEAM123456',
      topic: 'com.codeo.remote',
    });
  });
});
