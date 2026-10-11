import type { AgentProvider, ProviderSessionHandle, StartSessionOptions } from '@codeo/agent-provider-core';
import type { ProviderStatus } from '@codeo/domain';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  /** Every session start, with the prompt of its first turn. */
  starts: { cwd: string; model: string | null; prompts: string[] }[] = [];
  /** Turns whose prompt contains `wait-me` block until the test opens the gate. */
  gate: { promise: Promise<void>; open: () => void } = makeGate();
  async detect(): Promise<ProviderStatus> {
    return {
      provider: 'claude-code', displayName: 'Fake', installed: true, version: '0.0.0', executable: '/fake', authenticated: 'yes', authDetail: null,
      capabilities: { streaming: true, resume: true, interrupt: true, permissionRequests: true, modelSelection: false, toolCalls: true, structuredOutput: false, worktreeAware: false },
      models: [], modes: [], error: null, checkedAt: new Date().toISOString(),
    };
  }
  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    this.lastOpts = opts;
    if (opts.model === 'broken') throw new Error('Fake provider crashed');
    const record = { cwd: opts.cwd, model: opts.model, prompts: [] as string[] };
    this.starts.push(record);
    let sid: string | null = opts.resumeProviderSessionId;
    return {
      get providerSessionId() { return sid; },
      send: async (text) => {
        record.prompts.push(text);
        /* Like the real adapters, accept the turn immediately and run it asynchronously. */
        void (async () => {
        if (text.includes('wait-me')) await this.gate.promise;
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

function makeGate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

let repoDir: string;
let worktreesDir: string;
const fake = new FakeProvider();
let runtime: Runtime;
let server: RuntimeServer;
let client: RuntimeClient;
const TOKEN = 'test-token-0123456789abcdef';

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'codeo-rt-'));
  worktreesDir = mkdtempSync(path.join(os.tmpdir(), 'codeo-wt-'));
  await git(['init', '-q', '-b', 'main'], { cwd: repoDir });
  await git(['config', 'user.email', 'test@codeo.local'], { cwd: repoDir });
  await git(['config', 'user.name', 'Codeo Test'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'a.txt'), 'a');
  await git(['add', '.'], { cwd: repoDir });
  await git(['commit', '-q', '-m', 'init'], { cwd: repoDir });
  runtime = await createRuntime({ dataDir: ':memory:', worktreesDir, providers: [fake], logger: createLogger({ level: 'error' }) });
  await runtime.services.providers.detectAll();
  server = await startServer({ runtime, token: TOKEN, logger: createLogger({ level: 'error' }) });
  client = new RuntimeClient({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, client: { name: 'test', version: '0', kind: 'test' }, createWebSocket: (u) => new WebSocket(u) as never, reconnect: false });
  await client.connect();
});
/** Windows keeps handles on SQLite WAL and git files briefly after close: retry, and never fail the suite on cleanup. */
function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    console.warn(`cleanup of ${dir} skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

afterAll(async () => {
  client.close();
  await server.close();
  await runtime.shutdown();
  cleanupDir(repoDir);
  cleanupDir(worktreesDir);
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
    const { sessions: [session] } = await client.request('tasks.start', { taskId: task.id });
    if (!session) throw new Error('no session');
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

describe('orchestration and worktrees', () => {
  const waitTask = (taskId: string, status: string) => waitFor(async () => (await client.request('tasks.get', { taskId })).status === status);
  const wsId = async () => (await client.request('workspaces.list', {}))[0]!.id;
  const agent = (extra: Record<string, unknown> = {}) => ({ provider: 'claude-code' as const, ...extra });

  it('runs a single task in its own worktree, outside the repository', async () => {
    const before = fake.starts.length;
    const task = await client.request('tasks.create', { workspaceId: await wsId(), title: 'Réparer le login', ticketKey: 'PROJ-7', objective: 'Corrige', provider: 'claude-code' });
    expect(task.isolation).toBe('worktree');
    const { sessions } = await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'review');
    const [wt] = await client.request('worktrees.list', { taskId: task.id });
    expect(wt?.branch).toMatch(/^codeo\/proj-7-reparer-le-login-[0-9a-f]{8}$/);
    expect(wt?.path.startsWith(worktreesDir)).toBe(true);
    expect(fake.starts[before]?.cwd).toBe(wt?.path);
    expect(sessions[0]?.worktreeId).toBe(wt?.id);
    expect(fake.starts[before]?.prompts[0]).toContain(wt!.branch);
    expect((await client.request('tasks.get', { taskId: task.id })).subtasks[0]?.worktreeId).toBe(wt?.id);
  });

  it('chains pipeline steps in one shared worktree and hands each step the previous output', async () => {
    const before = fake.starts.length;
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Pipeline', objective: 'Ajouter un export CSV', provider: 'claude-code', orchestration: 'pipeline',
      subtasks: [agent({ title: 'Plan', role: 'planner' }), agent({ title: 'Code', role: 'backend' }), agent({ title: 'Tests', role: 'qa' })],
    });
    const started = await client.request('tasks.start', { taskId: task.id });
    expect(started.sessions).toHaveLength(1);
    await waitTask(task.id, 'review');
    const runs = fake.starts.slice(before);
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((r) => r.cwd)).size).toBe(1);
    expect(runs[0]?.prompts[0]).toContain('Étape 1/3 — Plan');
    expect(runs[0]?.prompts[0]).not.toContain('Résultat des étapes précédentes');
    expect(runs[2]?.prompts[0]).toContain('### Code (backend)');
    expect(runs[2]?.prompts[0]).toContain('Je commence.');
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(1);
    const done = await client.request('tasks.get', { taskId: task.id });
    expect(done.subtasks.map((s) => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(done.progress).toBe(90);
  });

  it('runs parallel subtasks in separate worktrees and honours dependencies', async () => {
    const before = fake.starts.length;
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Front et back', provider: 'claude-code', orchestration: 'parallel',
      subtasks: [agent({ title: 'API', role: 'backend' }), agent({ title: 'UI', role: 'frontend' }), agent({ title: 'Revue', role: 'reviewer', dependsOn: [0, 1] })],
    });
    const started = await client.request('tasks.start', { taskId: task.id });
    expect(started.sessions).toHaveLength(2);
    await waitTask(task.id, 'review');
    const runs = fake.starts.slice(before);
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((r) => r.cwd)).size).toBe(3);
    const wts = await client.request('worktrees.list', { taskId: task.id });
    expect(wts.map((w) => w.branch.slice(-2)).sort()).toEqual(['-1', '-2', '-3']);
  });

  it('refuses parallel agents without isolation and inconsistent plans', async () => {
    const workspaceId = await wsId();
    await expect(client.request('tasks.create', { workspaceId, title: 'x', provider: 'claude-code', orchestration: 'parallel', isolation: 'none', subtasks: [agent(), agent()] })).rejects.toThrow(/worktrees isolés/);
    await expect(client.request('tasks.create', { workspaceId, title: 'x', provider: 'claude-code', orchestration: 'best-of-n', subtasks: [agent()] })).rejects.toThrow(/deux agents/);
    await expect(client.request('tasks.create', { workspaceId, title: 'x', provider: 'claude-code', orchestration: 'parallel', subtasks: [agent({ dependsOn: [1] }), agent()] })).rejects.toThrow(/précédente/);
  });

  it('keeps best-of-n going when a candidate fails, and lets the human review the survivors', async () => {
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Trois essais', objective: 'Optimiser la requête', provider: 'claude-code', orchestration: 'best-of-n',
      subtasks: [agent(), agent({ model: 'broken' }), agent()],
    });
    const started = await client.request('tasks.start', { taskId: task.id });
    expect(started.sessions).toHaveLength(2);
    await waitTask(task.id, 'review');
    const after = await client.request('tasks.get', { taskId: task.id });
    expect(after.subtasks.map((s) => s.status)).toEqual(['completed', 'failed', 'completed']);
  });

  it('fails a pipeline whose step cannot start, cancels the blocked steps, and retries in the same worktree', async () => {
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Fragile', provider: 'claude-code', orchestration: 'sequential',
      subtasks: [agent(), agent({ model: 'broken' }), agent()],
    });
    await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'failed');
    const failed = await client.request('tasks.get', { taskId: task.id });
    expect(failed.subtasks.map((s) => s.status)).toEqual(['completed', 'failed', 'cancelled']);
    /* Retry: the completed step is kept, the others run again — still broken, so it fails again, without a new worktree. */
    await expect(client.request('tasks.start', { taskId: task.id })).rejects.toThrow(/crashed/);
    expect((await client.request('tasks.get', { taskId: task.id })).status).toBe('failed');
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(1);
  });

  it('pauses and resumes the running agents of a task', async () => {
    fake.gate = makeGate();
    const task = await client.request('tasks.create', { workspaceId: await wsId(), title: 'Longue', objective: 'wait-me', provider: 'claude-code' });
    const { sessions: [session] } = await client.request('tasks.start', { taskId: task.id });
    const paused = await client.request('tasks.pause', { taskId: task.id });
    expect(paused.status).toBe('paused');
    await waitFor(async () => (await client.request('sessions.get', { sessionId: session!.id })).session.status === 'cancelled');
    expect((await client.request('tasks.get', { taskId: task.id })).status).toBe('paused');
    fake.gate.open();
    const resumed = await client.request('tasks.resume', { taskId: task.id });
    expect(resumed.status).toBe('running');
    await waitTask(task.id, 'review');
    const { entries } = await client.request('sessions.get', { sessionId: session!.id });
    expect(entries.some((e) => e.kind === 'user_message' && e.text.startsWith('Reprends'))).toBe(true);
  });

  it('removes a worktree only when clean or forced, and keeps its branch', async () => {
    const task = (await client.request('tasks.list', {})).find((t) => t.title === 'Réparer le login')!;
    const [wt] = await client.request('worktrees.list', { taskId: task.id });
    writeFileSync(path.join(wt!.path, 'travail.txt'), 'non commité');
    expect((await client.request('worktrees.list', { taskId: task.id }))[0]?.dirty).toBe(true);
    /* An idle session is still live (resumable): the worktree stays until it is stopped. */
    const owner = (await client.request('sessions.list', { taskId: task.id })).find((s) => s.worktreeId === wt!.id)!;
    await expect(client.request('worktrees.remove', { worktreeId: wt!.id, force: true })).rejects.toThrow(/session est encore ouverte/);
    await client.request('sessions.cancel', { sessionId: owner.id });
    /* The workspace cannot disappear from under its worktrees either. */
    await expect(client.request('workspaces.delete', { workspaceId: task.workspaceId })).rejects.toThrow(/worktree/);
    await expect(client.request('worktrees.remove', { worktreeId: wt!.id })).rejects.toThrow(/non commitées/);
    expect(existsSync(wt!.path)).toBe(true);
    expect(await client.request('worktrees.remove', { worktreeId: wt!.id, force: true })).toEqual({ removed: true });
    expect(existsSync(wt!.path)).toBe(false);
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(0);
    await expect(git(['show-ref', '--verify', `refs/heads/${wt!.branch}`], { cwd: repoDir })).resolves.toBeTruthy();
    /* The session that lived there can no longer be resumed into a missing directory. */
    await expect(client.request('sessions.send', { sessionId: owner.id, text: 'encore' })).rejects.toThrow(/n’existe plus/);
  });
});

describe('shutdown', () => {
  it('leaves tasks in review untouched when their idle agents disconnect', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'codeo-rt2-'));
    const rt = await createRuntime({ dataDir: dir, worktreesDir: path.join(dir, 'wt'), providers: [new FakeProvider()], logger: createLogger({ level: 'error' }), detectProviders: false });
    await rt.services.providers.detectAll();
    const ws = await rt.services.workspaces.create({ name: 'w', type: 'monorepo', description: '', repositoryPaths: [repoDir] });
    const task = await rt.services.tasks.create({ workspaceId: ws.id, title: 'Revue', objective: '', ticketKey: null, repositoryIds: [], provider: 'claude-code', role: 'developer', model: null, orchestration: 'single', isolation: 'worktree', subtasks: [] });
    await rt.services.tasks.start(task.id);
    await waitFor(async () => (await rt.services.tasks.get(task.id)).status === 'review');
    await rt.shutdown();
    const reopened = await createRuntime({ dataDir: dir, worktreesDir: path.join(dir, 'wt'), providers: [new FakeProvider()], logger: createLogger({ level: 'error' }), detectProviders: false });
    expect((await reopened.services.tasks.get(task.id)).status).toBe('review');
    await reopened.shutdown();
    for (const w of await git(['worktree', 'list', '--porcelain'], { cwd: repoDir }).then((r) => r.stdout.split('\n').filter((l) => l.startsWith('worktree ') && l.includes(dir)))) {
      await git(['worktree', 'remove', '--force', w.slice(9)], { cwd: repoDir });
    }
    cleanupDir(dir);
  });
});
