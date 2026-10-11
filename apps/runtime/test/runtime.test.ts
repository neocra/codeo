import type { AgentProvider, ProviderSessionHandle, StartSessionOptions } from '@codeo/agent-provider-core';
import type { ProviderStatus } from '@codeo/domain';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '@codeo/git';
import { createRuntime, type Runtime } from '../src/runtime';
import { startServer, type RuntimeServer } from '../src/server/ws-server';
import { RuntimeClient } from '@codeo/remote-client';
import { createLogger } from '@codeo/shared-utils';
import WebSocket from 'ws';

/** A deterministic fake provider: NOT a stand-in for real integrations, only for exercising runtime logic. */
class FakeProvider implements AgentProvider {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Fake';
  lastOpts: StartSessionOptions | null = null;
  async detect(): Promise<ProviderStatus> {
    return {
      provider: 'claude-code', displayName: 'Fake', installed: true, version: '0.0.0', executable: '/fake', authenticated: 'yes', authDetail: null,
      capabilities: { streaming: true, resume: true, interrupt: true, permissionRequests: true, modelSelection: false, toolCalls: true, structuredOutput: false, worktreeAware: false },
      models: [], modes: [], error: null, checkedAt: new Date().toISOString(),
    };
  }
  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    this.lastOpts = opts;
    let sid: string | null = opts.resumeProviderSessionId;
    return {
      get providerSessionId() { return sid; },
      send: async (text) => {
        /* Like the real adapters, accept the turn immediately and run it asynchronously. */
        void (async () => {
        sid ??= 'prov-1';
        opts.onEvent({ type: 'session_started', providerSessionId: sid, model: 'fake-model' });
        opts.onEvent({ type: 'text_delta', blockId: 'b1', delta: 'Je ' });
        opts.onEvent({ type: 'text_delta', blockId: 'b1', delta: 'commence.' });
        opts.onEvent({ type: 'text_complete', blockId: 'b1', text: 'Je commence.' });
        if (text.includes('approve-me')) {
          const decision = await opts.onPermissionRequest({ providerRequestId: 'tu1', tool: 'Edit', input: { file_path: '/x.ts' }, summary: 'Modifier /x.ts', affected: ['/x.ts'], risk: 'medium', reason: null, signal: new AbortController().signal });
          opts.onEvent({ type: 'tool_call_started', toolUseId: 'tu1', tool: 'Edit', input: { file_path: '/x.ts' } });
          opts.onEvent({ type: 'tool_call_completed', toolUseId: 'tu1', output: decision.behavior, isError: decision.behavior === 'deny' });
        }
        opts.onEvent({ type: 'turn_completed', ok: true, summary: 'ok', durationMs: 5, costUsd: 0, turns: 1 });
        })();
      },
      interrupt: async () => {},
      close: async () => {},
    };
  }
}

let repoDir: string;
let runtime: Runtime;
let server: RuntimeServer;
let client: RuntimeClient;
const TOKEN = 'test-token-0123456789abcdef';

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'codeo-rt-'));
  await git(['init', '-q', '-b', 'main'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'a.txt'), 'a');
  runtime = await createRuntime({ dataDir: ':memory:', providers: [new FakeProvider()], logger: createLogger({ level: 'error' }) });
  await runtime.services.providers.detectAll();
  server = await startServer({ runtime, token: TOKEN, logger: createLogger({ level: 'error' }) });
  client = new RuntimeClient({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, client: { name: 'test', version: '0', kind: 'test' }, createWebSocket: (u) => new WebSocket(u) as never, reconnect: false });
  await client.connect();
});
afterAll(async () => {
  client.close();
  await server.close();
  await runtime.shutdown();
  rmSync(repoDir, { recursive: true, force: true });
});

const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 3000) => {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('runtime end-to-end over the protocol', () => {
  it('rejects a bad token', async () => {
    const bad = new RuntimeClient({ url: `ws://127.0.0.1:${server.port}`, token: 'wrong-token-0123456789', client: { name: 't', version: '0', kind: 'test' }, createWebSocket: (u) => new WebSocket(u) as never, reconnect: false });
    await expect(bad.connect()).rejects.toThrow();
  });

  it('creates a workspace from a git repository and refuses non-repositories', async () => {
    await expect(client.request('workspaces.create', { name: 'Bad', type: 'multi-repo', repositoryPaths: [os.tmpdir()] })).rejects.toThrow(/Git/);
    const ws = await client.request('workspaces.create', { name: 'Test WS', type: 'multi-repo', repositoryPaths: [repoDir] });
    expect(ws.repositories[0]?.defaultBranch).toBe('main');
  });

  it('runs a task through a session, streams entries, persists and reopens', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const received: string[] = [];
    client.on('event', ({ event }) => received.push(event.type));
    const task = await client.request('tasks.create', { workspaceId: ws!.id, title: 'Dire bonjour', objective: 'Écris bonjour', provider: 'claude-code' });
    expect(task.status).toBe('draft');
    const { session } = await client.request('tasks.start', { taskId: task.id });
    expect(session.status).toBe('running');
    await waitFor(() => received.includes('SessionEntryAppended') && received.includes('TaskUpdated'));
    await runtime.bus.flush();
    await waitFor(async () => (await client.request('sessions.get', { sessionId: session.id })).session.status === 'idle');
    const { session: after, entries } = await client.request('sessions.get', { sessionId: session.id });
    expect(after.providerSessionId).toBe('prov-1');
    expect(entries.map((e) => e.kind)).toEqual(['user_message', 'assistant_text', 'result']);
    expect((entries[1] as { text: string }).text).toBe('Je commence.');
    const t = await client.request('tasks.get', { taskId: task.id });
    expect(t.status).toBe('review');
    /* reopen: history is served from persistence, incremental fetch works */
    expect(await client.request('sessions.get', { sessionId: session.id, afterSeq: 2 })).toMatchObject({ entries: [{ kind: 'result' }] });
  });

  it('routes a permission request through an approval that a human decides', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const approvals: string[] = [];
    client.on('event', ({ event }) => { if (event.type === 'ApprovalRequested') approvals.push(event.approval.id); });
    const session = await client.request('sessions.start', { workspaceId: ws!.id, provider: 'claude-code', prompt: 'please approve-me' });
    await waitFor(() => approvals.length === 1);
    const pending = await client.request('approvals.list', { status: 'pending' });
    expect(pending[0]?.summary).toBe('Modifier /x.ts');
    const s1 = await client.request('sessions.get', { sessionId: session.id });
    expect(s1.session.status).toBe('waiting_approval');
    const resolved = await client.request('approvals.resolve', { approvalId: approvals[0]!, decision: 'approve' });
    expect(resolved.status).toBe('approved');
    await expect(client.request('approvals.resolve', { approvalId: approvals[0]!, decision: 'reject' })).rejects.toThrow();
    await waitFor(async () => (await client.request('sessions.get', { sessionId: session.id })).session.status === 'idle');
    const { entries } = await client.request('sessions.get', { sessionId: session.id });
    const tool = entries.find((e) => e.kind === 'tool_call') as { status: string; output: string } | undefined;
    expect(tool?.status).toBe('completed');
    expect(tool?.output).toBe('allow');
  });

  it('cancels a session cleanly and forbids out-of-scope commands', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const session = await client.request('sessions.start', { workspaceId: ws!.id, provider: 'claude-code', prompt: 'hello' });
    const cancelled = await client.request('sessions.cancel', { sessionId: session.id });
    expect(cancelled.status).toBe('cancelled');
    await expect(runtime.call('workspaces.delete', { workspaceId: ws!.id }, { scopes: ['read'], clientKind: 'mobile' })).rejects.toThrow(/Portée/);
  });

  it('replays missed events on reconnect', async () => {
    const late = new RuntimeClient({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, client: { name: 'late', version: '0', kind: 'test' }, createWebSocket: (u) => new WebSocket(u) as never, reconnect: false, replayFromStart: true });
    const seen: number[] = [];
    late.on('event', ({ seq }) => seen.push(seq));
    await late.connect();
    await waitFor(() => seen.length > 0);
    expect(seen[0]).toBe(1);
    late.close();
  });
});
