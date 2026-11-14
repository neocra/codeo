import { PROTOCOL_VERSION, type RuntimeInfo } from '@codeo/contracts';
import { buildApp, type GatewayApp } from '@codeo/gateway';
import { createMemoryStore } from '@codeo/gateway/src/store';
import { createLogger } from '@codeo/shared-utils';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  GatewayClientError,
  GatewaySession,
  RuntimeClient,
  completePairing,
  deviceConnectUrl,
  normalizeGatewayUrl,
  parsePairingQr,
  refreshCredentials,
  registerPushToken,
  unregisterPushToken,
  ApprovalPushDataSchema,
  type ConnectionState,
  type GatewayCredentials,
  type WebSocketFactory,
} from '../src/index';

/**
 * The phone side of remote access against a real gateway (in process, on loopback) and a scripted runtime
 * behind it: QR → pairing → device socket with a Bearer header → refresh with rotation → revocation.
 */

const quiet = createLogger({ level: 'error', sink: () => undefined });

const runtimeInfo: RuntimeInfo = {
  version: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  machine: { id: 'mach_test', name: 'test-mac', platform: 'darwin', runtimeVersion: '0.1.0', connection: 'gateway', status: 'connected' },
  dataDir: '/tmp/codeo-test',
  startedAt: '2026-01-01T00:00:00.000Z',
  demoMode: false,
};

/* The device factory the mobile app uses, with `ws` standing in for React Native's WebSocket. */
const wsFactory: WebSocketFactory = (url, init) => new WebSocket(url, { headers: init.headers }) as never;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

let gateway: GatewayApp;
let gatewayUrl: string;
let runtimeId: string;
let runtimeSecret: string;
let runtimeSocket: WebSocket;

async function post(path: string, body: unknown, bearer?: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${gatewayUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** A scripted runtime on the relay: answers `hello` and `runtime.info`. */
function connectRuntime(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${gatewayUrl.replace('http:', 'ws:')}/v1/runtimes/${runtimeId}/connect`, { headers: { authorization: `Bearer ${runtimeSecret}` } });
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { kind: string; id?: string; command?: string };
      if (msg.kind === 'hello') {
        ws.send(JSON.stringify({ kind: 'welcome', runtime: runtimeInfo, lastSeq: 0, scopes: ['read', 'session:write', 'approval:decide', 'workspace:admin'] }));
        resolve(ws);
      } else if (msg.kind === 'request' && msg.command === 'runtime.info') {
        ws.send(JSON.stringify({ kind: 'response', id: msg.id, ok: true, result: runtimeInfo }));
      }
    });
    ws.once('error', reject);
  });
}

async function startPairing(): Promise<{ code: string; qrPayload: string }> {
  const res = await post('/v1/pairing/start', {}, runtimeSecret);
  expect(res.status).toBe(201);
  return res.json as { code: string; qrPayload: string };
}

async function pair(): Promise<GatewayCredentials> {
  const qr = parsePairingQr((await startPairing()).qrPayload);
  return completePairing({ gatewayUrl: qr.gateway, code: qr.code, nonce: qr.nonce, runtimeId: qr.runtimeId, device: { name: 'iPhone de test', platform: 'ios' } });
}

beforeAll(async () => {
  const port = await freePort();
  gatewayUrl = `http://127.0.0.1:${port}`;
  gateway = await buildApp(
    {
      env: 'test', port, host: '127.0.0.1', publicUrl: gatewayUrl, secret: 'test-gateway-secret-0123456789abcdef0123456789',
      tls: null, trustProxy: false, pairingCodeTtlSeconds: 300, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600, logLevel: 'error',
      database: null, auditRetentionDays: 90, push: { apns: null, fcm: null },
    },
    createMemoryStore(),
    { logger: quiet },
  );
  await gateway.app.listen({ port, host: '127.0.0.1' });
  const reg = await post('/v1/runtimes/register', { name: 'mac', platform: 'darwin' });
  ({ runtimeId, runtimeSecret } = reg.json as { runtimeId: string; runtimeSecret: string });
  runtimeSocket = await connectRuntime();
});

afterAll(async () => {
  runtimeSocket.close();
  gateway.relay.close();
  await gateway.app.close();
});

describe('gateway URLs and QR codes', () => {
  it('accepts HTTPS anywhere and HTTP only for this machine', () => {
    expect(normalizeGatewayUrl('https://gw.example.com/codeo/?x=1')).toBe('https://gw.example.com/codeo');
    expect(normalizeGatewayUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeGatewayUrl('http://10.0.2.2:8787')).toBe('http://10.0.2.2:8787');
    expect(() => normalizeGatewayUrl('http://192.168.1.20:8787')).toThrow(expect.objectContaining({ code: 'INSECURE_GATEWAY' }));
    expect(() => normalizeGatewayUrl('ftp://gw.example.com')).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(deviceConnectUrl('https://gw.example.com/codeo')).toBe('wss://gw.example.com/codeo/v1/devices/connect');
  });

  it('refuses anything that is not a Codeo pairing QR code', () => {
    expect(() => parsePairingQr('https://example.com')).toThrow(expect.objectContaining({ code: 'INVALID_QR' }));
    expect(() => parsePairingQr(JSON.stringify({ v: 2, gateway: 'https://g', code: '123456', runtimeId: 'rt_x', nonce: 'abcdefgh' }))).toThrow(
      expect.objectContaining({ code: 'INVALID_QR' }),
    );
    expect(() => parsePairingQr(JSON.stringify({ v: 1, gateway: 'http://evil.example', code: '123456', runtimeId: 'rt_x', nonce: 'abcdefgh' }))).toThrow(
      expect.objectContaining({ code: 'INSECURE_GATEWAY' }),
    );
  });
});

describe('pairing and the device connection', () => {
  it('pairs from the QR code, then talks to the runtime with a Bearer header and the remote scopes', async () => {
    const creds = await pair();
    expect(creds.runtimeId).toBe(runtimeId);
    expect(creds.scopes).toEqual(['read', 'session:write', 'approval:decide']);
    expect(creds.gatewayUrl).toBe(gatewayUrl);

    const session = new GatewaySession({ credentials: creds, onCredentials: () => undefined });
    const client = new RuntimeClient({
      url: session.connectUrl,
      token: () => session.accessToken(),
      bearerHeader: true,
      client: { name: 'codeo-remote', version: '0', kind: 'mobile' },
      createWebSocket: wsFactory,
      reconnect: false,
    });
    await client.connect();
    expect(client.state).toBe('connected');
    expect(client.scopes).toEqual(['read', 'session:write', 'approval:decide']);
    const info = await client.request('runtime.info', {});
    expect(info.machine.name).toBe('test-mac');
    /* workspace:admin is refused at the gateway, before the runtime sees it. */
    await expect(client.request('remote.pairingStart', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    client.close();
  });

  it('pairs with a code typed by hand (no nonce) and refuses a used or wrong code', async () => {
    const { code } = await startPairing();
    const creds = await completePairing({ gatewayUrl, code, device: { name: 'Pixel', platform: 'android' } });
    expect(creds.deviceName).toBe('Pixel');
    await expect(completePairing({ gatewayUrl, code, device: { name: 'Pixel', platform: 'android' } })).rejects.toMatchObject({ code: 'PAIRING_REFUSED' });
    /* A QR code bound to another nonce burns the code. */
    const qr = parsePairingQr((await startPairing()).qrPayload);
    await expect(completePairing({ gatewayUrl, code: qr.code, nonce: 'wrong-nonce-123', runtimeId: qr.runtimeId, device: { name: 'x', platform: 'ios' } })).rejects.toMatchObject({
      code: 'PAIRING_REFUSED',
    });
    await expect(completePairing({ gatewayUrl, code: qr.code, nonce: qr.nonce, runtimeId: qr.runtimeId, device: { name: 'x', platform: 'ios' } })).rejects.toMatchObject({
      code: 'PAIRING_REFUSED',
    });
  });

  it('reports an unreachable gateway as retryable', async () => {
    const port = await freePort();
    const err = await completePairing({ gatewayUrl: `http://127.0.0.1:${port}`, code: '123456', device: { name: 'x', platform: 'ios' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayClientError);
    expect((err as GatewayClientError).code).toBe('UNREACHABLE');
    expect((err as GatewayClientError).fatal).toBe(false);
  });
});

describe('access-token refresh', () => {
  it('rotates before expiry, persists before handing out the token, and refreshes once for concurrent callers', async () => {
    const creds = await pair();
    const stored: GatewayCredentials[] = [];
    let now = Date.now();
    const session = new GatewaySession({ credentials: creds, onCredentials: (c) => void stored.push(c), now: () => now });
    expect(await session.accessToken()).toBe(creds.accessToken);
    expect(stored).toHaveLength(0);

    now = Date.parse(creds.accessTokenExpiresAt) - 30_000; /* inside the 60 s margin */
    const [a, b, c] = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    expect(stored).toHaveLength(1);
    expect(a).toBe(stored[0]!.accessToken);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(stored[0]!.refreshToken).not.toBe(creds.refreshToken);
    expect(session.credentials.refreshToken).toBe(stored[0]!.refreshToken);

    /* A forced refresh (the gateway refused the token) is rate limited. */
    now = Date.now();
    await session.accessToken({ force: true });
    expect(stored).toHaveLength(2);
    await session.accessToken({ force: true });
    expect(stored).toHaveLength(2);
  });

  it('keeps a key pinned on first use across a refresh in flight, and persists the newest tokens last', async () => {
    const creds = await pair();
    expect(creds.runtimeKey).toBeUndefined();
    const stored: GatewayCredentials[] = [];
    const session = new GatewaySession({ credentials: creds, onCredentials: (c) => void stored.push(c) });
    const refreshing = session.accessToken({ force: true });
    const key = 'cd'.repeat(32);
    await Promise.all([refreshing, session.pinRuntimeKey(key)]);
    expect(session.credentials).toMatchObject({ runtimeKey: key, runtimeKeySource: 'first-use' });
    expect(session.credentials.refreshToken).not.toBe(creds.refreshToken);
    expect(stored.at(-1)).toEqual(session.credentials);
    /* Pinned once: a later key is never accepted silently. */
    await session.pinRuntimeKey('ef'.repeat(32));
    expect(session.credentials.runtimeKey).toBe(key);
  });

  it('pins the QR code key at pairing', async () => {
    const qr = parsePairingQr(JSON.stringify({ ...JSON.parse((await startPairing()).qrPayload), key: 'ab'.repeat(32) }));
    const creds = await completePairing({ gatewayUrl: qr.gateway, code: qr.code, nonce: qr.nonce, runtimeId: qr.runtimeId, runtimeKey: qr.key, device: { name: 'iPhone', platform: 'ios' } });
    expect(creds).toMatchObject({ runtimeKey: 'ab'.repeat(32), runtimeKeySource: 'qr' });
    const another = JSON.parse((await startPairing()).qrPayload) as object;
    expect(() => parsePairingQr(JSON.stringify({ ...another, key: 'not-hex' }))).toThrow();
  });

  it('treats a replayed refresh token as theft: the phone is revoked and the error is fatal', async () => {
    const creds = await pair();
    const rotated = await refreshCredentials(creds);
    expect(rotated.refreshToken).not.toBe(creds.refreshToken);
    const err = (await refreshCredentials(creds).catch((e: unknown) => e)) as GatewayClientError;
    expect(err.code).toBe('REVOKED');
    expect(err.fatal).toBe(true);
    /* The legitimate copy is cut off too (its refresh tokens were dropped with the device). */
    const after = (await refreshCredentials(rotated).catch((e: unknown) => e)) as GatewayClientError;
    expect(after.fatal).toBe(true);
  });
});

describe('push registration', () => {
  it('registers and removes this phone\'s token, and reports that the gateway cannot deliver without credentials', async () => {
    const creds = await pair();
    const session = new GatewaySession({ credentials: creds, onCredentials: () => undefined });
    const delivery = await registerPushToken(session, { provider: 'apns', token: 'ab'.repeat(32), environment: 'sandbox', locale: 'fr' });
    expect(delivery).toBe('unconfigured');
    await expect(registerPushToken(session, { provider: 'fcm', token: `t:${'x'.repeat(40)}`, locale: 'fr' })).rejects.toMatchObject({ code: 'BAD_RESPONSE', status: 400 });
    await unregisterPushToken(session);
  });

  it('accepts only the gateway\'s approval notifications', () => {
    expect(ApprovalPushDataSchema.safeParse({ type: 'approval', runtimeId: 'rt_1abc', approvalId: 'apr_1' }).success).toBe(true);
    expect(ApprovalPushDataSchema.safeParse({ type: 'url', href: 'https://evil.example' }).success).toBe(false);
  });
});

describe('revocation', () => {
  it('a revoked phone ends in `unauthorized` instead of reconnecting forever', async () => {
    const creds = await pair();
    const session = new GatewaySession({ credentials: creds, onCredentials: () => undefined });
    const states: ConnectionState[] = [];
    const client = new RuntimeClient({
      url: session.connectUrl,
      token: (req) => session.accessToken({ force: req.rejected || req.failures >= 2 }),
      bearerHeader: true,
      client: { name: 'codeo-remote', version: '0', kind: 'mobile' },
      createWebSocket: wsFactory,
    });
    client.on('state', (s) => states.push(s));
    await client.connect();

    const revoke = await post(`/v1/devices/${creds.deviceId}/revoke`, {}, runtimeSecret);
    expect(revoke.status).toBe(200);
    /* 4003 → the client renews its token at once → the gateway refuses the refresh (403) → terminal. */
    await waitFor(() => client.state === 'unauthorized');
    expect(states).toContain('reconnecting');
    await new Promise((r) => setTimeout(r, 100));
    expect(client.state).toBe('unauthorized');
    client.close();
  });
});
