import WebSocket from 'ws';
import type { RuntimeInfo } from '@codeo/contracts';
import { createLogger } from '@codeo/shared-utils';
import { buildApp, type GatewayApp } from '../src/app';
import type { GatewayConfig } from '../src/config';
import { createMemoryStore, type GatewayStore } from '../src/store';

export const TEST_SECRET = 'test-gateway-secret-0123456789abcdef0123456789';

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    env: 'test',
    port: 0,
    host: '127.0.0.1',
    publicUrl: 'https://gateway.test',
    secret: TEST_SECRET,
    tls: null,
    trustProxy: false,
    pairingCodeTtlSeconds: 300,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 30 * 24 * 3600,
    logLevel: 'error',
    ...overrides,
  };
}

/** Controllable clock: `advance` moves time forward for every service that was built with it. */
export function fakeClock(start = Date.UTC(2026, 0, 1)) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

export interface TestContext extends GatewayApp {
  store: GatewayStore;
  config: GatewayConfig;
  clock: ReturnType<typeof fakeClock>;
}

export async function createTestApp(overrides: Partial<GatewayConfig> = {}): Promise<TestContext> {
  const config = testConfig(overrides);
  const store = createMemoryStore();
  const clock = fakeClock();
  const built = await buildApp(config, store, { logger: createLogger({ level: 'error', sink: () => undefined }), clock: clock.now });
  return { ...built, store, config, clock };
}

export async function registerRuntime(ctx: TestContext): Promise<{ runtimeId: string; runtimeSecret: string }> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/runtimes/register', payload: { name: 'mac', platform: 'darwin' } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json<{ runtimeId: string; runtimeSecret: string }>();
  return { runtimeId: body.runtimeId, runtimeSecret: body.runtimeSecret };
}

export interface PairedDevice {
  deviceId: string;
  runtimeId: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
}

export async function pairDevice(ctx: TestContext, runtimeSecret: string, name = 'iPhone'): Promise<PairedDevice> {
  const start = await ctx.app.inject({ method: 'POST', url: '/v1/pairing/start', headers: { authorization: `Bearer ${runtimeSecret}` } });
  if (start.statusCode !== 201) throw new Error(`pairing start failed: ${start.body}`);
  const { code } = start.json<{ code: string }>();
  const complete = await ctx.app.inject({
    method: 'POST',
    url: '/v1/pairing/complete',
    payload: { code, device: { name, platform: 'ios' } },
  });
  if (complete.statusCode !== 201) throw new Error(`pairing complete failed: ${complete.body}`);
  return complete.json<PairedDevice>();
}

export const sampleRuntimeInfo: RuntimeInfo = {
  version: '0.1.0',
  protocolVersion: 1,
  machine: { id: 'mach_test', name: 'test-mac', platform: 'darwin', runtimeVersion: '0.1.0', connection: 'gateway', status: 'connected' },
  dataDir: '/tmp/codeo-test',
  startedAt: '2026-01-01T00:00:00.000Z',
  demoMode: true,
};

/**
 * Opens a socket with a bearer header; resolves on open, rejects on error. The reader is attached
 * before the socket opens: the server may send its first frame in the same TCP chunk as the 101
 * response, in which case `ws` emits `open` and `message` back-to-back and a listener attached
 * after `open` would miss it.
 */
export function connectWs(url: string, bearer: string): Promise<{ ws: WebSocket; reader: Reader }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${bearer}` } });
    const reader = createReader(ws);
    ws.once('open', () => resolve({ ws, reader }));
    ws.once('error', reject);
  });
}

/** Attempts an upgrade that is expected to be refused; resolves with the HTTP status. */
export function expectUpgradeRefused(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    ws.once('open', () => reject(new Error('upgrade unexpectedly succeeded')));
    ws.once('error', reject);
  });
}

export interface Reader {
  next(timeoutMs?: number): Promise<unknown>;
  pending(): number;
}

/** Buffers every JSON frame so tests never miss one that arrived before they started waiting. */
export function createReader(ws: WebSocket): Reader {
  const queue: unknown[] = [];
  const waiters: ((m: unknown) => void)[] = [];
  ws.on('message', (data) => {
    const msg: unknown = JSON.parse(String(data));
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  return {
    next: (timeoutMs = 3000) =>
      new Promise<unknown>((resolve, reject) => {
        if (queue.length > 0) {
          resolve(queue.shift());
          return;
        }
        const timer = setTimeout(() => reject(new Error('timeout waiting for websocket message')), timeoutMs);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
    pending: () => queue.length,
  };
}

export function waitClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: String(reason) });
    });
  });
}

export function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}
