import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import {
  connectWs,
  createTestApp,
  expectUpgradeRefused,
  pairDevice,
  registerRuntime,
  sampleRuntimeInfo,
  send,
  waitClose,
  type PairedDevice,
  type Reader,
  type TestContext,
} from './helpers';
import { CLOSE_RUNTIME_OFFLINE, CLOSE_UNAUTHORIZED } from '../src/relay';

let ctx: TestContext;
let base: string;
let runtimeId: string;
let runtimeSecret: string;
let runtimeWs: WebSocket;
let runtimeReader: Reader;

const hello = (token: string, afterSeq = -1) => ({
  kind: 'hello',
  protocolVersion: 1,
  token,
  client: { name: 'test-mobile', version: '0.0.0', kind: 'mobile' },
  afterSeq,
});

async function connectDevice(device: PairedDevice, afterSeq = -1): Promise<{ ws: WebSocket; reader: Reader; welcome: Record<string, unknown> }> {
  const { ws, reader } = await connectWs(`${base}/v1/devices/connect`, device.accessToken);
  send(ws, hello(device.accessToken, afterSeq));
  const welcome = (await reader.next()) as Record<string, unknown>;
  return { ws, reader, welcome };
}

/** A fake runtime relay client: answers the gateway hello with a welcome, keeps the socket. */
async function connectFakeRuntime(): Promise<{ ws: WebSocket; reader: Reader }> {
  const { ws, reader } = await connectWs(`${base}/v1/runtimes/${runtimeId}/connect`, runtimeSecret);
  const gatewayHello = (await reader.next()) as { kind: string; client: { kind: string }; afterSeq: number };
  expect(gatewayHello.kind).toBe('hello');
  expect(gatewayHello.client.kind).toBe('gateway');
  send(ws, { kind: 'welcome', runtime: sampleRuntimeInfo, lastSeq: 0, scopes: ['read', 'session:write', 'approval:decide', 'workspace:admin'] });
  return { ws, reader };
}

beforeAll(async () => {
  ctx = await createTestApp();
  const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = address.replace(/^http/, 'ws');
  ({ runtimeId, runtimeSecret } = await registerRuntime(ctx));
  ({ ws: runtimeWs, reader: runtimeReader } = await connectFakeRuntime());
});
afterAll(async () => {
  runtimeWs.close();
  await ctx.app.close();
});

describe('relay authentication', () => {
  it('refuses runtime upgrades without a valid secret or with a mismatched id', async () => {
    expect(await expectUpgradeRefused(`${base}/v1/runtimes/${runtimeId}/connect`, {})).toBe(401);
    expect(await expectUpgradeRefused(`${base}/v1/runtimes/${runtimeId}/connect`, { authorization: `Bearer ${runtimeId}.nope` })).toBe(401);
    expect(await expectUpgradeRefused(`${base}/v1/runtimes/rt_other/connect`, { authorization: `Bearer ${runtimeSecret}` })).toBe(403);
  });

  it('refuses device upgrades without a valid access token and never accepts tokens in the URL', async () => {
    expect(await expectUpgradeRefused(`${base}/v1/devices/connect`, {})).toBe(401);
    expect(await expectUpgradeRefused(`${base}/v1/devices/connect`, { authorization: 'Bearer v1.garbage.garbage' })).toBe(401);
    const device = await pairDevice(ctx, runtimeSecret);
    expect(await expectUpgradeRefused(`${base}/v1/devices/connect?token=${device.accessToken}`, {})).toBe(400);
    const refused = await ctx.store.audit.list({ action: 'relay.device.connect' });
    expect(refused.some((e) => !e.ok && e.detail === 'credentials passed in URL')).toBe(true);
  });

  it('closes a device whose hello token belongs to someone else', async () => {
    const a = await pairDevice(ctx, runtimeSecret, 'A');
    const b = await pairDevice(ctx, runtimeSecret, 'B');
    const { ws } = await connectWs(`${base}/v1/devices/connect`, a.accessToken);
    const closed = waitClose(ws);
    send(ws, hello(b.accessToken));
    expect((await closed).code).toBe(CLOSE_UNAUTHORIZED);
  });
});

describe('relay authorization and routing', () => {
  it('welcomes a device with its narrowed scopes', async () => {
    const device = await pairDevice(ctx, runtimeSecret);
    const { ws, welcome } = await connectDevice(device);
    expect(welcome['kind']).toBe('welcome');
    expect(welcome['scopes']).toEqual(['read', 'session:write', 'approval:decide']);
    expect((welcome['runtime'] as { version: string }).version).toBe(sampleRuntimeInfo.version);
    expect(ctx.relay.isDeviceConnected(device.deviceId)).toBe(true);
    ws.close();
  });

  it('refuses a command outside the device scopes before the runtime sees it', async () => {
    const device = await pairDevice(ctx, runtimeSecret);
    const { ws, reader } = await connectDevice(device);
    expect(runtimeReader.pending()).toBe(0);

    send(ws, { kind: 'request', id: 'r1', command: 'workspaces.create', params: { name: 'x', type: 'monorepo', repositoryPaths: ['/tmp'] } });
    const refused = (await reader.next()) as { kind: string; id: string; ok: boolean; error: { code: string } };
    expect(refused).toMatchObject({ kind: 'response', id: 'r1', ok: false, error: { code: 'FORBIDDEN' } });

    /* The very next frame the runtime receives is a permitted request: the refused one never reached it. */
    send(ws, { kind: 'request', id: 'r2', command: 'runtime.info', params: {} });
    const forwarded = (await runtimeReader.next()) as { kind: string; id: string; command: string };
    expect(forwarded.kind).toBe('request');
    expect(forwarded.command).toBe('runtime.info');
    expect(forwarded.id.endsWith(':r2')).toBe(true);
    expect(forwarded.id).not.toBe('r2');
    expect(runtimeReader.pending()).toBe(0);

    /* The response is routed back with the original id. */
    send(runtimeWs, { kind: 'response', id: forwarded.id, ok: true, result: sampleRuntimeInfo });
    const response = (await reader.next()) as { kind: string; id: string; ok: boolean };
    expect(response).toMatchObject({ kind: 'response', id: 'r2', ok: true });

    const audit = await ctx.store.audit.list({ action: 'relay.request.refused' });
    const entry = audit.at(-1);
    expect(entry).toMatchObject({ ok: false, target: 'workspaces.create', actor: `device:${device.deviceId}` });
    expect(entry?.detail).not.toContain('/tmp');
    ws.close();
  });

  it('broadcasts events to every device, dedupes by seq and replays from the ring buffer', async () => {
    const d1 = await pairDevice(ctx, runtimeSecret, 'one');
    const d2 = await pairDevice(ctx, runtimeSecret, 'two');
    const c1 = await connectDevice(d1);
    const c2 = await connectDevice(d2);

    const event = (seq: number) => ({
      kind: 'event',
      seq,
      event: { id: `ev_${seq}`, at: '2026-01-01T00:00:00.000Z', type: 'RuntimeReady', version: '0.1.0' },
    });
    send(runtimeWs, event(1));
    send(runtimeWs, event(2));
    send(runtimeWs, event(2)); /* duplicate: dropped */
    expect((await c1.reader.next()) as object).toMatchObject({ kind: 'event', seq: 1 });
    expect((await c1.reader.next()) as object).toMatchObject({ kind: 'event', seq: 2 });
    expect((await c2.reader.next()) as object).toMatchObject({ kind: 'event', seq: 1 });
    expect((await c2.reader.next()) as object).toMatchObject({ kind: 'event', seq: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(c1.reader.pending()).toBe(0);

    /* A reconnecting device asks for everything after seq 1 and gets seq 2 from the gateway's buffer. */
    c1.ws.close();
    const again = await connectDevice(d1, 1);
    expect(again.welcome['lastSeq']).toBe(2);
    expect((await again.reader.next()) as object).toMatchObject({ kind: 'event', seq: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(again.reader.pending()).toBe(0);
    again.ws.close();
    c2.ws.close();
  });

  it('disconnects a device when it is revoked', async () => {
    const device = await pairDevice(ctx, runtimeSecret, 'doomed');
    const { ws } = await connectDevice(device);
    const closed = waitClose(ws);
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/devices/${device.deviceId}/revoke`, headers: { authorization: `Bearer ${runtimeSecret}` } });
    expect(res.statusCode).toBe(200);
    expect((await closed).code).toBe(CLOSE_UNAUTHORIZED);
    expect(ctx.relay.isDeviceConnected(device.deviceId)).toBe(false);
    /* The still-valid access token no longer opens a socket. */
    expect(await expectUpgradeRefused(`${base}/v1/devices/connect`, { authorization: `Bearer ${device.accessToken}` })).toBe(403);
  });

  it('answers pings itself and rejects requests before hello', async () => {
    const device = await pairDevice(ctx, runtimeSecret);
    const { ws, reader } = await connectWs(`${base}/v1/devices/connect`, device.accessToken);
    send(ws, { kind: 'request', id: 'early', command: 'runtime.info', params: {} });
    expect((await reader.next()) as object).toMatchObject({ kind: 'error', message: 'hello required' });
    send(ws, hello(device.accessToken));
    expect(((await reader.next()) as { kind: string }).kind).toBe('welcome');
    send(ws, { kind: 'ping', t: 42 });
    expect((await reader.next()) as object).toEqual({ kind: 'pong', t: 42 });
    expect(runtimeReader.pending()).toBe(0);
    ws.close();
  });
});

describe('runtime lifecycle', () => {
  it('a device cannot complete hello while its runtime is offline', async () => {
    const other = await registerRuntime(ctx);
    const device = await pairDevice(ctx, other.runtimeSecret, 'orphan');
    const { ws } = await connectWs(`${base}/v1/devices/connect`, device.accessToken);
    const closed = waitClose(ws);
    send(ws, hello(device.accessToken));
    expect((await closed).code).toBe(CLOSE_RUNTIME_OFFLINE);
  });

  it('a newer runtime connection replaces the previous one', async () => {
    const replaced = waitClose(runtimeWs);
    const fresh = await connectFakeRuntime();
    expect((await replaced).code).toBe(4000);
    expect(ctx.relay.isRuntimeConnected(runtimeId)).toBe(true);
    runtimeWs = fresh.ws;
    runtimeReader = fresh.reader;
    const audit = await ctx.store.audit.list({ action: 'relay.runtime.connect' });
    expect(audit.filter((e) => e.ok && e.actor === `runtime:${runtimeId}`).length).toBeGreaterThanOrEqual(2);
  });
});
