import type { AgentProvider, ProviderSessionHandle, StartSessionOptions } from '@codeo/agent-provider-core';
import type { RemoteStatus, RuntimeEvent } from '@codeo/contracts';
import type { ProviderStatus } from '@codeo/domain';
import { buildApp, type GatewayApp } from '@codeo/gateway';
import { createMemoryStore } from '@codeo/gateway/src/store';
import { git } from '@codeo/git';
import { RuntimeClient } from '@codeo/remote-client';
import { createLogger } from '@codeo/shared-utils';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RelayClient, type RelayState } from '../src/remote/relay-client';
import { createRuntime, type CallContext, type Runtime } from '../src/runtime';

/*
 * Remote access end to end: a real gateway (in process, on loopback) between this runtime and a "phone"
 * that is a plain RuntimeClient. Nothing is mocked between the three: HTTP registration and pairing,
 * the outbound relay socket, scope enforcement, event fan-out and revocation all run for real.
 */

/** Deterministic agent that asks for one approval; NOT a stand-in for a real provider. */
class ApprovalProvider implements AgentProvider {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Fake';
  decisions: string[] = [];
  async detect(): Promise<ProviderStatus> {
    return {
      provider: 'claude-code', displayName: 'Fake', installed: true, version: '0.0.0', executable: '/fake', authenticated: 'yes', authDetail: null,
      capabilities: { streaming: true, resume: true, interrupt: true, permissionRequests: true, modelSelection: false, toolCalls: true, structuredOutput: false, worktreeAware: false },
      models: [], modes: [], error: null, checkedAt: new Date().toISOString(),
    };
  }
  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    return {
      providerSessionId: 'prov-remote',
      send: async () => {
        void (async () => {
          opts.onEvent({ type: 'session_started', providerSessionId: 'prov-remote', model: 'fake' });
          const d = await opts.onPermissionRequest({ providerRequestId: 'tu1', tool: 'Edit', input: { file_path: '/x.ts' }, summary: 'Modifier /x.ts', affected: ['/x.ts'], risk: 'medium', reason: null, signal: new AbortController().signal });
          this.decisions.push(d.behavior);
          opts.onEvent({ type: 'turn_completed', ok: true, summary: 'ok', durationMs: 1, costUsd: 0, turns: 1 });
        })();
      },
      interrupt: async () => {},
      close: async () => {},
    };
  }
}

const LOCAL: CallContext = { scopes: ['read', 'session:write', 'approval:decide', 'workspace:admin'], clientKind: 'desktop' };
const quiet = createLogger({ level: 'error', sink: () => undefined });

const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 5000) => {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let gateway: GatewayApp;
let gatewayUrl: string;
let runtime: Runtime;
let repoDir: string;
let worktreesDir: string;
const provider = new ApprovalProvider();
const statuses: RemoteStatus[] = [];

async function startGateway(): Promise<GatewayApp> {
  const built = await buildApp(
    {
      env: 'test', port: 0, host: '127.0.0.1', publicUrl: 'http://127.0.0.1', secret: 'test-gateway-secret-0123456789abcdef0123456789',
      tls: null, trustProxy: false, pairingCodeTtlSeconds: 300, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600, logLevel: 'error',
    },
    createMemoryStore(),
    { logger: quiet },
  );
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  return built;
}

function phone(accessToken: string): RuntimeClient {
  const url = gatewayUrl.replace('http:', 'ws:') + '/v1/devices/connect';
  return new RuntimeClient({
    url,
    token: accessToken,
    client: { name: 'phone', version: '0', kind: 'mobile' },
    createWebSocket: (u) => new WebSocket(u, { headers: { authorization: `Bearer ${accessToken}` } }) as never,
    reconnect: false,
  });
}

async function pairPhone(): Promise<{ accessToken: string; deviceId: string }> {
  const pairing = await runtime.call('remote.pairingStart', {}, LOCAL);
  const qr = JSON.parse(pairing.qrPayload) as { code: string; nonce: string; runtimeId: string };
  expect(qr.code).toBe(pairing.code);
  const res = await fetch(`${gatewayUrl}/v1/pairing/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: qr.code, nonce: qr.nonce, runtimeId: qr.runtimeId, device: { name: 'iPhone de test', platform: 'ios' } }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { accessToken: string; device: { deviceId: string } };
  return { accessToken: body.accessToken, deviceId: body.device.deviceId };
}

beforeAll(async () => {
  gateway = await startGateway();
  const addr = gateway.app.server.address();
  gatewayUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'codeo-remote-'));
  worktreesDir = mkdtempSync(path.join(os.tmpdir(), 'codeo-remote-wt-'));
  await git(['init', '-q', '-b', 'main'], { cwd: repoDir });
  await git(['config', 'user.email', 'test@codeo.local'], { cwd: repoDir });
  await git(['config', 'user.name', 'Codeo Test'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'a.txt'), 'a');
  await git(['add', '.'], { cwd: repoDir });
  await git(['commit', '-q', '-m', 'init'], { cwd: repoDir });
  runtime = await createRuntime({
    dataDir: ':memory:', worktreesDir, providers: [provider], detectProviders: false, pullRequestRefreshMs: 0, logger: quiet,
    remote: { backoff: { minMs: 50, maxMs: 200 } },
  });
  await runtime.services.providers.detectAll();
  runtime.bus.on('event', ({ event }) => {
    if (event.type === 'RemoteStatusChanged') statuses.push(event.status);
  });
});

afterAll(async () => {
  await runtime.shutdown();
  gateway.relay.close();
  await gateway.app.close();
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(worktreesDir, { recursive: true, force: true });
});

describe('remote access through the gateway', () => {
  it('is off by default and refuses pairing until enabled', async () => {
    expect(await runtime.call('remote.status', {}, LOCAL)).toMatchObject({ enabled: false, connection: 'disabled', runtimeId: null });
    await expect(runtime.call('remote.pairingStart', {}, LOCAL)).rejects.toThrow(/accès distant/);
    await expect(runtime.call('remote.enable', { gatewayUrl: 'http://gateway.example.com' }, LOCAL)).rejects.toThrow(/HTTPS/);
  });

  it('registers, dials out and is connected without opening any port', async () => {
    const status = await runtime.call('remote.enable', { gatewayUrl: `${gatewayUrl}/` }, LOCAL);
    expect(status.enabled).toBe(true);
    expect(status.gatewayUrl).toBe(gatewayUrl);
    expect(status.runtimeId).toMatch(/^rt/);
    await waitFor(() => runtime.services.remote.status().connection === 'connected');
    expect(gateway.relay.isRuntimeConnected(status.runtimeId!)).toBe(true);
    expect(statuses.some((s) => s.connection === 'connected')).toBe(true);
    /* The secret is never part of what a client can read. */
    expect(JSON.stringify(await runtime.call('remote.status', {}, LOCAL))).not.toMatch(/secret/i);
  });

  it('pairs a phone by QR payload; the phone reads state, gets events and approves, but cannot administer', async () => {
    const { accessToken, deviceId } = await pairPhone();
    const client = phone(accessToken);
    await client.connect();
    expect(client.scopes).toEqual(['read', 'session:write', 'approval:decide']);
    expect((await client.request('runtime.info', {})).machine.id).toBe(runtime.info.machine.id);

    /* workspace:admin is refused by the gateway, and would be by the runtime too. */
    await expect(client.request('remote.pairingStart', {})).rejects.toThrow(/workspace:admin/);
    await expect(runtime.call('workspaces.create', { name: 'x', type: 'monorepo', repositoryPaths: [repoDir] }, { scopes: ['read', 'session:write', 'approval:decide'], clientKind: 'gateway' })).rejects.toThrow(/Portée/);

    const seen: RuntimeEvent[] = [];
    client.on('event', ({ event }) => seen.push(event));
    const ws = await runtime.call('workspaces.create', { name: 'Remote', type: 'monorepo', repositoryPaths: [repoDir] }, LOCAL);
    await waitFor(() => seen.some((e) => e.type === 'WorkspaceCreated'));

    /* The phone starts an agent session and decides its approval: it is recorded as a mobile decision. */
    await client.request('sessions.start', { workspaceId: ws.id, provider: 'claude-code', prompt: 'go' });
    await waitFor(() => seen.some((e) => e.type === 'ApprovalRequested'));
    const [pending] = await client.request('approvals.list', { status: 'pending' });
    const resolved = await client.request('approvals.resolve', { approvalId: pending!.id, decision: 'approve' });
    expect(resolved.decidedBy).toBe('mobile');
    await waitFor(() => provider.decisions.length === 1);
    expect(provider.decisions).toEqual(['allow']);

    const devices = await runtime.call('remote.devices', {}, LOCAL);
    expect(devices).toEqual([expect.objectContaining({ deviceId, name: 'iPhone de test', platform: 'ios', connected: true, revoked: false })]);

    /* Revoking from the desktop cuts the phone off immediately. */
    const closed = new Promise<void>((resolve) => client.on('state', (s) => s === 'closed' && resolve()));
    expect(await runtime.call('remote.revokeDevice', { deviceId }, LOCAL)).toEqual({ deviceId, revoked: true });
    await closed;
    expect((await runtime.call('remote.devices', {}, LOCAL))[0]).toMatchObject({ revoked: true, connected: false });
  });

  it('disables and re-enables with the same registration', async () => {
    const before = runtime.services.remote.status().runtimeId!;
    const off = await runtime.call('remote.disable', {}, LOCAL);
    expect(off).toMatchObject({ enabled: false, connection: 'disabled' });
    await waitFor(() => !gateway.relay.isRuntimeConnected(before));
    const on = await runtime.call('remote.enable', { gatewayUrl }, LOCAL);
    expect(on.runtimeId).toBe(before);
    await waitFor(() => runtime.services.remote.status().connection === 'connected');
  });

  it('reconnects after the gateway drops the runtime and replays what it missed', async () => {
    const { accessToken } = await pairPhone();
    const runtimeId = runtime.services.remote.status().runtimeId!;
    /* A gateway-side drop (e.g. a restart of its process) → the relay client retries with backoff. */
    gateway.relay.close();
    await waitFor(() => runtime.services.remote.status().connection !== 'connected');
    await waitFor(() => runtime.services.remote.status().connection === 'connected');
    expect(gateway.relay.isRuntimeConnected(runtimeId)).toBe(true);
    const client = phone(accessToken);
    await client.connect();
    expect((await client.request('home.summary', {})).workspace?.name).toBe('Remote');
    client.close();
  });
});

describe('relay client', () => {
  it('stops retrying when the gateway refuses the runtime secret', async () => {
    const states: RelayState[] = [];
    const relay = new RelayClient({
      url: `${gatewayUrl.replace('http:', 'ws:')}/v1/runtimes/rt_unknown/connect`,
      secret: 'rt_unknown.not-a-real-secret-0123456789',
      runtime,
      log: quiet,
      onState: (s) => states.push(s),
      backoff: { minMs: 20, maxMs: 40 },
    });
    relay.start();
    await waitFor(() => states.some((s) => s.connection === 'unauthorized'));
    await new Promise((r) => setTimeout(r, 150));
    expect(states.filter((s) => s.connection === 'connecting')).toHaveLength(1);
    await relay.stop();
  });
});
