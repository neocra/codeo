import type { AgentProvider, ProviderSessionHandle, StartSessionOptions } from '@codeo/agent-provider-core';
import type { ProviderStatus } from '@codeo/domain';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from '@codeo/git';
import { createRuntime, type Runtime } from '../src/runtime';
import { startServer, type RuntimeServer } from '../src/server/ws-server';
import { RuntimeClient } from '@codeo/remote-client';
import { createLogger } from '@codeo/shared-utils';
import WebSocket from 'ws';
import type { GitHubClient, RemotePullRequest } from '../src/github/gh-cli';

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
        const failing = text.includes('fail-turn');
        opts.onEvent({ type: 'turn_completed', ok: !failing, summary: failing ? 'quota épuisé' : 'ok', durationMs: 5, costUsd: 0, turns: 1 });
        })();
      },
      interrupt: async () => {},
      close: async () => {},
    };
  }
}

/** Records what the runtime asks of the code host; NOT a GitHub integration, only a test double for the gh client. */
class FakeGitHub implements GitHubClient {
  authenticated = true;
  prs = new Map<string, RemotePullRequest>();
  created: { cwd: string; base: string; head: string; title: string; body: string; draft: boolean }[] = [];
  async status() {
    return { installed: true, version: '0.0.0', authenticated: this.authenticated, detail: null };
  }
  async findByBranch(_cwd: string, branch: string) {
    return [...this.prs.values()].find((p) => p.branch === branch) ?? null;
  }
  async create(cwd: string, input: { base: string; head: string; title: string; body: string; draft: boolean }) {
    this.created.push({ cwd, ...input });
    const number = this.created.length;
    const pr: RemotePullRequest = { number, url: `https://github.example/acme/app/pull/${number}`, title: input.title, branch: input.head, baseBranch: input.base, status: input.draft ? 'draft' : 'open', additions: 1, deletions: 0, checks: [{ name: 'ci', status: 'queued', url: null }] };
    this.prs.set(pr.url, pr);
    return pr;
  }
  async view(_cwd: string, url: string) {
    const pr = this.prs.get(url);
    if (!pr) throw new Error(`no PR ${url}`);
    return pr;
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
const github = new FakeGitHub();
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
  runtime = await createRuntime({ dataDir: ':memory:', worktreesDir, providers: [fake], github, pullRequestRefreshMs: 0, logger: createLogger({ level: 'error' }) });
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
    /* The session opens with a `system` entry announcing its execution mode, then the turn transcript. */
    expect(entries.map((e) => e.kind)).toEqual(['system', 'user_message', 'assistant_text', 'result']);
    expect((entries[2] as { text: string }).text).toBe('Je commence.');
    const t = await client.request('tasks.get', { taskId: task.id });
    expect(t.status).toBe('review');
    /* reopen: history is served from persistence, incremental fetch works */
    expect(await client.request('sessions.get', { sessionId: session.id, afterSeq: 3 })).toMatchObject({ entries: [{ kind: 'result' }] });
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

  it('threads the execution mode from the workspace default onto a session and honours an override', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const inherited = await client.request('sessions.start', { workspaceId: ws!.id, provider: 'claude-code', prompt: 'hello' });
    const d1 = await client.request('sessions.get', { sessionId: inherited.id });
    expect(d1.session.executionMode).toBe(ws!.defaultExecutionMode);
    const overridden = await client.request('sessions.start', { workspaceId: ws!.id, provider: 'claude-code', executionMode: 'manual', prompt: 'hello' });
    const d2 = await client.request('sessions.get', { sessionId: overridden.id });
    expect(d2.session.executionMode).toBe('manual');
  });

  it('changes the workspace default execution mode, which new sessions then inherit', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const updated = await client.request('workspaces.update', { workspaceId: ws!.id, defaultExecutionMode: 'full' });
    expect(updated.defaultExecutionMode).toBe('full');
    const session = await client.request('sessions.start', { workspaceId: ws!.id, provider: 'claude-code', prompt: 'hello' });
    expect((await client.request('sessions.get', { sessionId: session.id })).session.executionMode).toBe('full');
    await client.request('workspaces.update', { workspaceId: ws!.id, defaultExecutionMode: 'auto' });
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

  it('shows a worktree diff against its base, then completes the review and releases the agents', async () => {
    const task = await client.request('tasks.create', { workspaceId: await wsId(), title: 'Diff', objective: 'Changer a.txt', provider: 'claude-code' });
    await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'review');
    const [wt] = await client.request('worktrees.list', { taskId: task.id });
    /* The fake agent writes nothing: stand in for its work directly in the worktree. */
    writeFileSync(path.join(wt!.path, 'a.txt'), 'b\n');
    writeFileSync(path.join(wt!.path, 'new.md'), '# nouveau\n');
    const diff = await client.request('worktrees.diff', { worktreeId: wt!.id });
    expect(diff.uncommitted).toBe(true);
    expect(diff.commits).toBe(0);
    expect(diff.files.map((f) => [f.path, f.status]).sort()).toEqual([['a.txt', 'modified'], ['new.md', 'added']]);
    expect(diff.files.find((f) => f.path === 'new.md')?.hunks[0]?.lines[0]).toEqual({ type: 'add', old: null, new: 1, text: '# nouveau' });

    await expect(client.request('tasks.complete', { taskId: task.id, winnerSubtaskId: task.subtasks[0]!.id })).rejects.toThrow(/Best-of-N/);
    const done = await client.request('tasks.complete', { taskId: task.id });
    expect(done.status).toBe('completed');
    expect(done.progress).toBe(100);
    expect(done.completedAt).not.toBeNull();
    expect(done.winnerSubtaskId).toBeNull();
    const sessionId = done.subtasks[0]!.sessionId!;
    await waitFor(async () => (await client.request('sessions.get', { sessionId })).session.status === 'completed');
    expect(runtime.services.sessions.isLive(sessionId)).toBe(false);
    await expect(client.request('sessions.send', { sessionId, text: 'encore' })).rejects.toThrow(/terminée/);
    await expect(client.request('tasks.complete', { taskId: task.id })).rejects.toThrow(/en revue/);
    /* Completion keeps the work: the worktree and its changes are still there for the PR flow. */
    expect((await client.request('worktrees.diff', { worktreeId: wt!.id })).files).toHaveLength(2);
  });

  it('completes a best-of-n review only with a finished candidate as the winner', async () => {
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Choix', objective: 'Deux essais', provider: 'claude-code', orchestration: 'best-of-n',
      subtasks: [agent(), agent({ model: 'broken' }), agent()],
    });
    await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'review');
    const [first, broken, third] = (await client.request('tasks.get', { taskId: task.id })).subtasks;
    await expect(client.request('tasks.complete', { taskId: task.id })).rejects.toThrow(/Choisissez/);
    await expect(client.request('tasks.complete', { taskId: task.id, winnerSubtaskId: broken!.id })).rejects.toThrow(/candidat terminé/);
    const done = await client.request('tasks.complete', { taskId: task.id, winnerSubtaskId: third!.id });
    expect(done.status).toBe('completed');
    expect(done.winnerSubtaskId).toBe(third!.id);
    expect((await client.request('tasks.get', { taskId: task.id })).winnerSubtaskId).toBe(third!.id);
    expect(first!.status).toBe('completed');
  });

  it('publishes the kept best-of-n candidate as a pull request: commit, push, open, then adopt and refresh', async () => {
    const remote = mkdtempSync(path.join(os.tmpdir(), 'codeo-origin-'));
    await git(['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
    await git(['remote', 'add', 'origin', remote], { cwd: repoDir });
    try {
      const task = await client.request('tasks.create', {
        workspaceId: await wsId(), title: 'Publier', ticketKey: 'PROJ-9', objective: 'Ajouter la note', provider: 'claude-code', orchestration: 'best-of-n',
        subtasks: [agent({ title: 'Essai A' }), agent({ title: 'Essai B' })],
      });
      await client.request('tasks.start', { taskId: task.id });
      await waitTask(task.id, 'review');
      await expect(client.request('pullRequests.create', { taskId: task.id })).rejects.toThrow(/Validez la revue/);
      const reviewed = await client.request('tasks.get', { taskId: task.id });
      const winner = reviewed.subtasks[1]!;
      const lanes = await client.request('worktrees.list', { taskId: task.id });
      const kept = lanes.find((w) => w.id === winner.worktreeId)!;
      writeFileSync(path.join(kept.path, 'NOTE.md'), 'agent B\n');
      writeFileSync(path.join(lanes.find((w) => w.id !== kept.id)!.path, 'LOSER.md'), 'agent A\n');
      await client.request('tasks.complete', { taskId: task.id, winnerSubtaskId: winner.id });

      github.authenticated = false;
      await expect(client.request('pullRequests.create', { taskId: task.id })).rejects.toThrow(/gh auth login/);
      github.authenticated = true;

      const { pullRequests: [pr], skipped } = await client.request('pullRequests.create', { taskId: task.id, draft: true });
      expect(skipped).toEqual([]);
      expect(pr).toMatchObject({ taskId: task.id, worktreeId: kept.id, branch: kept.branch, baseBranch: 'main', status: 'draft', number: 1 });
      expect(github.created).toHaveLength(1);
      expect(github.created[0]).toMatchObject({ cwd: kept.path, base: 'main', head: kept.branch, title: 'PROJ-9: Publier', draft: true });
      expect(github.created[0]!.body).toContain('Ajouter la note');
      /* The winner's work is committed and pushed; the losing candidate is not published. */
      expect((await git(['status', '--porcelain'], { cwd: kept.path })).stdout).toBe('');
      expect((await git(['show', `refs/heads/${kept.branch}:NOTE.md`], { cwd: remote })).stdout).toBe('agent B\n');
      expect((await git(['log', '-1', '--format=%s', `refs/heads/${kept.branch}`], { cwd: remote })).stdout.trim()).toBe('PROJ-9: Publier');
      expect((await git(['for-each-ref', '--format=%(refname)', 'refs/heads/'], { cwd: remote })).stdout.trim().split('\n')).toEqual([`refs/heads/${kept.branch}`]);

      /* Re-running publishes new work on the same PR instead of opening another one. */
      writeFileSync(path.join(kept.path, 'NOTE.md'), 'agent B, v2\n');
      const again = await client.request('pullRequests.create', { taskId: task.id });
      expect(again.pullRequests[0]?.id).toBe(pr!.id);
      expect(github.created).toHaveLength(1);
      expect((await git(['show', `refs/heads/${kept.branch}:NOTE.md`], { cwd: remote })).stdout).toBe('agent B, v2\n');

      github.prs.set(pr!.url, { ...github.prs.get(pr!.url)!, status: 'merged', checks: [{ name: 'ci', status: 'success', url: null }] });
      const refreshed = await client.request('pullRequests.refresh', { pullRequestId: pr!.id });
      expect(refreshed).toMatchObject({ status: 'merged', checks: [{ name: 'ci', status: 'success', url: null }] });
      expect(await client.request('pullRequests.list', { taskId: task.id })).toHaveLength(1);
      /* Merged: the clean winner's worktree is removed, its branch kept; the unpublished candidate is untouched. */
      const after = await client.request('worktrees.list', { taskId: task.id });
      expect(after.map((w) => w.id)).not.toContain(kept.id);
      expect(after).toHaveLength(1);
      expect(existsSync(kept.path)).toBe(false);
      await expect(git(['show-ref', '--verify', `refs/heads/${kept.branch}`], { cwd: repoDir })).resolves.toBeTruthy();
      /* Refreshing again still works from the repository itself. */
      expect((await client.request('pullRequests.refresh', { pullRequestId: pr!.id })).status).toBe('merged');

      /* A completed task whose agents changed nothing has nothing to publish. */
      const empty = await client.request('tasks.create', { workspaceId: await wsId(), title: 'Rien', provider: 'claude-code' });
      await client.request('tasks.start', { taskId: empty.id });
      await waitTask(empty.id, 'review');
      await client.request('tasks.complete', { taskId: empty.id });
      const nothing = await client.request('pullRequests.create', { taskId: empty.id });
      expect(nothing.pullRequests).toEqual([]);
      expect(nothing.skipped).toHaveLength(1);
      expect(github.created).toHaveLength(1);
    } finally {
      await git(['remote', 'remove', 'origin'], { cwd: repoDir });
      cleanupDir(remote);
    }
  });

  it('links parallel lanes\u2019 pull requests to their dependencies and follows them in the background', async () => {
    const remote = mkdtempSync(path.join(os.tmpdir(), 'codeo-origin-'));
    await git(['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
    await git(['remote', 'add', 'origin', remote], { cwd: repoDir });
    try {
      const task = await client.request('tasks.create', {
        workspaceId: await wsId(), title: 'Lots', provider: 'claude-code', orchestration: 'parallel',
        subtasks: [agent({ title: 'API' }), agent({ title: 'UI', dependsOn: [0] })],
      });
      await client.request('tasks.start', { taskId: task.id });
      await waitTask(task.id, 'review');
      const planned = await client.request('tasks.get', { taskId: task.id });
      const [api, ui] = [planned.subtasks.find((x) => x.title === 'API')!, planned.subtasks.find((x) => x.title === 'UI')!];
      const lanes = await client.request('worktrees.list', { taskId: task.id });
      const apiLane = lanes.find((w) => w.subtaskId === api.id)!;
      const uiLane = lanes.find((w) => w.subtaskId === ui.id)!;
      writeFileSync(path.join(apiLane.path, 'API.md'), 'api\n');
      writeFileSync(path.join(uiLane.path, 'UI.md'), 'ui\n');
      await client.request('tasks.complete', { taskId: task.id });

      const createdBefore = github.created.length;
      const { pullRequests } = await client.request('pullRequests.create', { taskId: task.id });
      const apiPr = pullRequests.find((p) => p.worktreeId === apiLane.id)!;
      const uiPr = pullRequests.find((p) => p.worktreeId === uiLane.id)!;
      expect(apiPr.dependsOn).toEqual([]);
      expect(uiPr.dependsOn).toEqual([apiPr.id]);
      /* The dependency is opened first and named in the dependent PR's description. */
      const opened = github.created.slice(createdBefore);
      expect(opened.map((c) => c.head)).toEqual([apiLane.branch, uiLane.branch]);
      expect(opened[1]!.body).toContain(`Dépend de :\n- ${apiPr.url}`);
      expect(opened[0]!.body).not.toContain('Dépend de');

      /* Background pass: unchanged PRs are re-read quietly, a change is announced. */
      const seen: string[] = [];
      await runtime.bus.flush();
      const off = runtime.bus.on('event', ({ event: e }) => {
        if (e.type === 'PullRequestUpdated') seen.push(e.pullRequest.id);
      });
      try {
        const quiet = await runtime.services.pullRequests.refreshActive();
        expect(quiet.failed).toBe(0);
        expect(quiet.refreshed).toBeGreaterThanOrEqual(2);
        await runtime.bus.flush();
        expect(seen).toEqual([]);

        /* The API PR is merged on GitHub while the UI lane still has uncommitted work. */
        github.prs.set(apiPr.url, { ...github.prs.get(apiPr.url)!, status: 'merged' });
        github.prs.set(uiPr.url, { ...github.prs.get(uiPr.url)!, status: 'merged' });
        writeFileSync(path.join(uiLane.path, 'WIP.md'), 'pas fini\n');
        const pass = await runtime.services.pullRequests.refreshActive();
        expect(pass.cleaned).toBe(1);
        await runtime.bus.flush();
        expect(seen).toEqual(expect.arrayContaining([apiPr.id, uiPr.id]));
        const left = await client.request('worktrees.list', { taskId: task.id });
        expect(left.map((w) => w.id)).toEqual([uiLane.id]);
        expect(existsSync(path.join(uiLane.path, 'WIP.md'))).toBe(true);
        expect((await client.request('pullRequests.list', { taskId: task.id })).every((p) => p.status === 'merged')).toBe(true);

        /* Once the work is committed, the next pass cleans the remaining lane up without asking GitHub again. */
        github.authenticated = false;
        await git(['add', '-A'], { cwd: uiLane.path });
        await git(['commit', '-q', '-m', 'wip'], { cwd: uiLane.path });
        expect((await runtime.services.pullRequests.refreshActive()).cleaned).toBe(1);
        expect(await client.request('worktrees.list', { taskId: task.id })).toEqual([]);
      } finally {
        off();
        github.authenticated = true;
      }
      const home = await client.request('home.summary', {});
      expect(home.openPullRequests.map((p) => p.id)).not.toContain(apiPr.id);
    } finally {
      await git(['remote', 'remove', 'origin'], { cwd: repoDir });
      cleanupDir(remote);
    }
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
    /* Recovery goes through tasks.start, never through a raw send to one of its sessions. */
    await expect(client.request('sessions.send', { sessionId: failed.subtasks[0]!.sessionId!, text: 'encore' })).rejects.toThrow(/en échec/);
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
    await expect(client.request('sessions.send', { sessionId: session!.id, text: 'encore' })).rejects.toThrow(/en pause/);
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
    const owner = (await client.request('sessions.list', { taskId: task.id })).find((s) => s.worktreeId === wt!.id)!;
    expect((await client.request('sessions.get', { sessionId: owner.id })).session.status).toBe('idle');
    /* The workspace cannot disappear from under its worktrees. */
    await expect(client.request('workspaces.delete', { workspaceId: task.workspaceId })).rejects.toThrow(/worktree/);
    await expect(client.request('worktrees.remove', { worktreeId: wt!.id })).rejects.toThrow(/non commitées/);
    expect(existsSync(wt!.path)).toBe(true);
    expect(await client.request('worktrees.remove', { worktreeId: wt!.id, force: true })).toEqual({ removed: true });
    expect(existsSync(wt!.path)).toBe(false);
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(0);
    await expect(git(['show-ref', '--verify', `refs/heads/${wt!.branch}`], { cwd: repoDir })).resolves.toBeTruthy();
    /* The idle owner was closed with its worktree and cannot be resumed into a missing directory. */
    expect((await client.request('sessions.get', { sessionId: owner.id })).session.status).toBe('completed');
    await expect(client.request('sessions.send', { sessionId: owner.id, text: 'encore' })).rejects.toThrow(/n’existe plus/);
  });

  it('treats a failed provider turn as a failed step, not a completed one', async () => {
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Tour raté', provider: 'claude-code', orchestration: 'sequential',
      subtasks: [agent({ title: 'Casse fail-turn', role: 'backend' }), agent({ title: 'Suite', role: 'qa' })],
    });
    await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'failed');
    const failed = await client.request('tasks.get', { taskId: task.id });
    expect(failed.subtasks.map((s) => s.status)).toEqual(['failed', 'cancelled']);
    expect(failed.subtasks[0]?.error).toContain('quota épuisé');
    expect((await client.request('sessions.get', { sessionId: failed.subtasks[0]!.sessionId! })).session.status).toBe('failed');
    /* A retry replaces the session; the old one is closed and can no longer be driven. */
    const oldSession = failed.subtasks[0]!.sessionId!;
    await client.request('tasks.start', { taskId: task.id });
    await waitTask(task.id, 'failed');
    const retried = await client.request('tasks.get', { taskId: task.id });
    expect(retried.subtasks[0]!.sessionId).not.toBe(oldSession);
    expect(runtime.services.sessions.isLive(oldSession)).toBe(false);
    await expect(client.request('sessions.send', { sessionId: oldSession, text: 'encore' })).rejects.toThrow(/remplacée/);
  });

  it('refuses a send while another step works in the shared worktree, and once the task is closed', async () => {
    fake.gate = makeGate();
    const task = await client.request('tasks.create', {
      workspaceId: await wsId(), title: 'Garde', objective: 'Vérifier les envois', provider: 'claude-code', orchestration: 'pipeline',
      subtasks: [agent({ title: 'Plan', role: 'planner' }), agent({ title: 'Code wait-me', role: 'backend' })],
    });
    await client.request('tasks.start', { taskId: task.id });
    await waitFor(async () => (await client.request('tasks.get', { taskId: task.id })).subtasks[1]?.status === 'running');
    const current = await client.request('tasks.get', { taskId: task.id });
    const first = current.subtasks[0]!;
    expect(first.status).toBe('completed');
    await expect(client.request('sessions.send', { sessionId: first.sessionId!, text: 'encore' })).rejects.toThrow(/travaille déjà/);
    fake.gate.open();
    await waitTask(task.id, 'review');
    await client.request('tasks.cancel', { taskId: task.id });
    await expect(client.request('sessions.send', { sessionId: first.sessionId!, text: 'encore' })).rejects.toThrow(/terminée/);
  });

});

describe('worktree recovery', () => {
  it('recreates a worktree whose directory was deleted outside Codeo, on the same branch', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const task = await runtime.services.tasks.create({ workspaceId: ws!.id, title: 'Recréer', objective: '', ticketKey: null, repositoryIds: [], provider: 'claude-code', role: 'developer', model: null, orchestration: 'single', isolation: 'worktree', subtasks: [] });
    const sub = task.subtasks[0]!;
    const repoId = ws!.repositories[0]!.id;
    const first = await runtime.services.worktrees.ensureForSubtask(task, sub, repoId);
    expect(existsSync(first.path)).toBe(true);
    rmSync(first.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    const again = await runtime.services.worktrees.ensureForSubtask(task, sub, repoId);
    expect(again.id).not.toBe(first.id);
    expect(again.path).toBe(first.path);
    expect(again.branch).toBe(first.branch);
    expect(existsSync(again.path)).toBe(true);
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(1);
    await runtime.services.worktrees.remove(again.id, { force: true });
  });

  it('refuses a plain folder that replaced a registered worktree directory', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const task = await runtime.services.tasks.create({ workspaceId: ws!.id, title: 'Remplacé', objective: '', ticketKey: null, repositoryIds: [], provider: 'claude-code', role: 'developer', model: null, orchestration: 'single', isolation: 'worktree', subtasks: [] });
    const sub = task.subtasks[0]!;
    const repoId = ws!.repositories[0]!.id;
    const wt = await runtime.services.worktrees.ensureForSubtask(task, sub, repoId);
    /* Deleted outside Codeo and replaced by unrelated files: git still registers the path, the folder is not a worktree. */
    rmSync(wt.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    mkdirSync(wt.path, { recursive: true });
    writeFileSync(path.join(wt.path, 'intrus.txt'), 'x');
    await expect(runtime.services.worktrees.ensureForSubtask(task, sub, repoId)).rejects.toThrow(/n’est plus le worktree/);
    await expect(runtime.services.worktrees.assertIntact(wt.id)).rejects.toThrow(/n’est plus le worktree/);
    await expect(runtime.services.worktrees.remove(wt.id, { force: true })).rejects.toThrow(/n’est plus le worktree/);
    rmSync(wt.path, { recursive: true, force: true });
    await runtime.services.worktrees.remove(wt.id, { force: true });
  });

  it('adopts a worktree left by a run that died before persisting it, and refuses a foreign folder', async () => {
    const [ws] = await client.request('workspaces.list', {});
    const task = await runtime.services.tasks.create({ workspaceId: ws!.id, title: 'Adopter', objective: '', ticketKey: null, repositoryIds: [], provider: 'claude-code', role: 'developer', model: null, orchestration: 'single', isolation: 'worktree', subtasks: [] });
    const sub = task.subtasks[0]!;
    const repoId = ws!.repositories[0]!.id;
    const wt = await runtime.services.worktrees.ensureForSubtask(task, sub, repoId);
    /* Simulate the crash: the git worktree exists but the row does not. */
    const rows = await client.request('worktrees.list', { taskId: task.id });
    expect(rows).toHaveLength(1);
    await (runtime.services.worktrees as unknown as { repo: { delete(id: string): Promise<void> } }).repo.delete(wt.id);
    const adopted = await runtime.services.worktrees.ensureForSubtask(task, sub, repoId);
    expect(adopted.path).toBe(wt.path);
    expect(adopted.branch).toBe(wt.branch);
    expect(await client.request('worktrees.list', { taskId: task.id })).toHaveLength(1);
    await runtime.services.worktrees.remove(adopted.id, { force: true });
    /* A foreign folder at the expected path is never touched. */
    mkdirSync(wt.path, { recursive: true });
    writeFileSync(path.join(wt.path, 'etranger.txt'), 'x');
    await expect(runtime.services.worktrees.ensureForSubtask(task, sub, repoId)).rejects.toThrow(/n’est pas le worktree attendu/);
    rmSync(wt.path, { recursive: true, force: true });
  });
});

describe('shutdown', () => {
  it('leaves tasks in review untouched when their idle agents disconnect', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'codeo-rt2-'));
    const rt = await createRuntime({ dataDir: dir, worktreesDir: path.join(dir, 'wt'), providers: [new FakeProvider()], logger: createLogger({ level: 'error' }), detectProviders: false, pullRequestRefreshMs: 0 });
    await rt.services.providers.detectAll();
    const ws = await rt.services.workspaces.create({ name: 'w', type: 'monorepo', description: '', repositoryPaths: [repoDir] });
    const task = await rt.services.tasks.create({ workspaceId: ws.id, title: 'Revue', objective: '', ticketKey: null, repositoryIds: [], provider: 'claude-code', role: 'developer', model: null, orchestration: 'single', isolation: 'worktree', subtasks: [] });
    await rt.services.tasks.start(task.id);
    await waitFor(async () => (await rt.services.tasks.get(task.id)).status === 'review');
    await rt.shutdown();
    const reopened = await createRuntime({ dataDir: dir, worktreesDir: path.join(dir, 'wt'), providers: [new FakeProvider()], logger: createLogger({ level: 'error' }), detectProviders: false, pullRequestRefreshMs: 0 });
    expect((await reopened.services.tasks.get(task.id)).status).toBe('review');
    /* Removing the reviewed worktree after the restart closes its disconnected owner cleanly: no failure anywhere. */
    const [wt] = await reopened.services.worktrees.list({ taskId: task.id });
    const owner = (await reopened.services.sessions.list({ taskId: task.id }))[0]!;
    expect(owner.status).toBe('disconnected');
    await reopened.call('worktrees.remove', { worktreeId: wt!.id, force: true }, { scopes: ['read', 'session:write', 'approval:decide', 'workspace:admin'], clientKind: 'test' });
    expect((await reopened.services.sessions.get(owner.id)).status).toBe('completed');
    const after = await reopened.services.tasks.get(task.id);
    expect(after.status).toBe('review');
    expect(after.subtasks[0]?.status).toBe('completed');
    await reopened.shutdown();
    for (const w of await git(['worktree', 'list', '--porcelain'], { cwd: repoDir }).then((r) => r.stdout.split('\n').filter((l) => l.startsWith('worktree ') && l.includes(dir)))) {
      await git(['worktree', 'remove', '--force', w.slice(9)], { cwd: repoDir });
    }
    cleanupDir(dir);
  });
});
