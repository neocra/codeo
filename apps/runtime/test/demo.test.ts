import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorktreeDiffSchema } from '@codeo/contracts';
import { ApprovalRepo, openDatabase, PullRequestRepo, SessionRepo, SettingsRepo, TaskRepo, WorkspaceRepo, WorktreeRepo } from '@codeo/database';
import { AgentSessionSchema, ApprovalRequestSchema, PullRequestSchema, SessionEntrySchema, TaskSchema, WorkspaceSchema, WorktreeSchema } from '@codeo/domain';
import { createLogger } from '@codeo/shared-utils';
import { buildDemoDataset, DEMO_LIVE_TASK_ID } from '../src/demo/dataset';
import { demoWorktreeDiff } from '../src/demo/diffs';
import { DEMO_DATASET_VERSION, seedDemoData } from '../src/demo/seed';
import { createRuntime, type Runtime } from '../src/runtime';

const logger = createLogger({ level: 'error' });
const ctx = { scopes: ['read', 'session:write', 'approval:decide', 'workspace:admin'] as const, clientKind: 'test' as const };
const call = <C extends Parameters<Runtime['call']>[0]>(rt: Runtime, c: C, p: unknown) => rt.call(c, p, { ...ctx, scopes: [...ctx.scopes] });

const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 3000) => {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('demo dataset', () => {
  it('is valid domain data with consistent references', () => {
    const d = buildDemoDataset('mac_demo');
    d.workspaces.forEach((w) => WorkspaceSchema.parse(w));
    d.tasks.forEach((t) => TaskSchema.parse(t));
    d.sessions.forEach((s) => AgentSessionSchema.parse(s));
    d.entries.forEach((e) => SessionEntrySchema.parse(e));
    d.approvals.forEach((a) => ApprovalRequestSchema.parse(a));
    expect(d.workspaces.map((w) => w.name)).toEqual(['Elyndor', 'Codeo Cloud']);
    const repoIds = new Set(d.workspaces.flatMap((w) => w.repositories.map((r) => r.id)));
    for (const t of d.tasks) for (const id of t.repositoryIds) expect(repoIds.has(id)).toBe(true);
    for (const s of d.sessions) expect(d.tasks.find((t) => t.id === s.taskId)?.subtasks[0]?.sessionId).toBe(s.id);
    /* Fictional paths only: nothing points at a real folder. */
    for (const w of d.workspaces) for (const r of w.repositories) expect(r.path.startsWith('demo://')).toBe(true);
    expect(d.tasks.find((t) => t.id === DEMO_LIVE_TASK_ID)?.status).toBe('draft');
  });

  it('gives the reviewed tasks fictional lanes with scripted diffs, and pull requests', () => {
    const d = buildDemoDataset('mac_demo');
    d.worktrees.forEach((w) => WorktreeSchema.parse(w));
    d.pullRequests.forEach((pr) => PullRequestSchema.parse(pr));
    for (const w of d.worktrees) {
      expect(w.path.startsWith('demo://')).toBe(true);
      expect(w.branch).toMatch(/^codeo\//);
      const task = d.tasks.find((t) => t.id === w.taskId)!;
      expect(task.isolation).toBe('worktree');
      expect(['review', 'completed']).toContain(task.status);
      expect(task.subtasks[0]?.worktreeId).toBe(w.id);
      /* The agent worked in its lane. */
      const session = d.sessions.find((s) => s.id === task.subtasks[0]?.sessionId)!;
      expect([session.cwd, session.worktreeId]).toEqual([w.path, w.id]);
      const diff = WorktreeDiffSchema.parse(demoWorktreeDiff(w));
      expect(diff.files.length).toBeGreaterThan(0);
      expect(diff.additions).toBe(diff.files.reduce((n, f) => n + f.additions, 0));
      /* Hunk headers agree with their lines, as git's would. */
      for (const f of diff.files)
        for (const h of f.hunks) {
          const [, oldStart, oldCount, newStart, newCount] = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(h.header)!.map(Number);
          expect(h.lines.filter((l) => l.type !== 'add').length).toBe(oldCount);
          expect(h.lines.filter((l) => l.type !== 'del').length).toBe(newCount);
          const first = h.lines[0]!;
          if (first.old !== null) expect(first.old).toBe(oldStart);
          if (first.new !== null) expect(first.new).toBe(newStart);
        }
    }
    /* Every other task stays without isolation, like the tasks created in demo mode. */
    const laneTasks = new Set(d.worktrees.map((w) => w.taskId));
    for (const t of d.tasks.filter((x) => !laneTasks.has(x.id))) expect(t.isolation).toBe('none');
    for (const pr of d.pullRequests) {
      const lane = d.worktrees.find((w) => w.id === pr.worktreeId)!;
      expect([pr.taskId, pr.branch]).toEqual([lane.taskId, lane.branch]);
      expect(pr.additions).toBe(demoWorktreeDiff(lane)!.additions);
    }
    expect(d.pullRequests.map((pr) => pr.status).sort()).toEqual(['approved', 'open']);
  });
});

describe('demo runtime', () => {
  let rt: Runtime;
  beforeAll(async () => {
    rt = await createRuntime({ dataDir: ':memory:', demo: true, demoStepMs: 0, detectProviders: false, logger });
    await rt.services.providers.detectAll();
  });
  afterAll(() => rt.shutdown());

  it('serves the seeded dataset with scripted agents, flagged as demo', async () => {
    expect(rt.info.demoMode).toBe(true);
    expect((await call(rt, 'workspaces.list', {})).map((w) => w.name)).toEqual(['Elyndor', 'Codeo Cloud']);
    expect((await call(rt, 'tasks.list', {})).length).toBe(8);
    const { entries } = await call(rt, 'sessions.get', { sessionId: 'ses_demo_ely142' });
    expect(entries.at(-1)?.kind).toBe('result');
    const providers = await call(rt, 'providers.list', {});
    expect(providers.map((p) => [p.provider, p.version, p.executable])).toEqual([
      ['claude-code', 'demo', null],
      ['codex', 'demo', null],
    ]);
  });

  it('reviews the scripted diff of a demo lane and sends changes back to its agent', async () => {
    const [lane] = await call(rt, 'worktrees.list', { taskId: 'task_demo_ely142' });
    expect(lane).toMatchObject({ id: 'wt_demo_ely142', dirty: false });
    const diff = await call(rt, 'worktrees.diff', { worktreeId: lane!.id });
    expect(diff.uncommitted).toBe(true);
    expect(diff.files.map((f) => f.path)).toContain('Assets/Scripts/Inventory/InventoryGrid.cs');

    await call(rt, 'tasks.requestChanges', {
      taskId: 'task_demo_ely142',
      feedback: 'Limite à 20 pour les matériaux rares.',
      comments: [{ path: 'Assets/Scripts/Items/ItemDefinition.cs', line: 11, side: 'new', excerpt: '    [Min(1)] public int MaxStack = 99;', body: 'Pas pour les objets uniques.' }],
    });
    await waitFor(async () => (await call(rt, 'approvals.list', { status: 'pending' })).length === 1);
    const [pending] = await call(rt, 'approvals.list', { status: 'pending' });
    await call(rt, 'approvals.resolve', { approvalId: pending!.id, decision: 'approve' });
    await waitFor(async () => (await call(rt, 'tasks.get', { taskId: 'task_demo_ely142' })).status === 'review');
    const task = await call(rt, 'tasks.get', { taskId: 'task_demo_ely142' });
    expect(task.subtasks[0]).toMatchObject({ reviewRounds: 1, sessionId: 'ses_demo_ely142', worktreeId: 'wt_demo_ely142' });
  });

  it('shows fictional pull requests and never reads them from GitHub', async () => {
    const prs = await call(rt, 'pullRequests.list', {});
    expect(prs.map((pr) => [pr.number, pr.status])).toEqual(expect.arrayContaining([[87, 'open'], [212, 'approved']]));
    expect(prs.find((pr) => pr.number === 87)?.checks.map((c) => c.status)).toEqual(['success', 'failure', 'running']);
    await expect(call(rt, 'pullRequests.refresh', { pullRequestId: 'pr_demo_ely136' })).rejects.toThrow(/démo/);
    const home = await call(rt, 'home.summary', { workspaceId: 'ws_demo_elyndor' });
    expect(home.openPullRequests.map((pr) => pr.number)).toEqual([87]);
  });

  it('refuses real repositories', async () => {
    await expect(call(rt, 'workspaces.create', { name: 'Réel', type: 'multi-repo', repositoryPaths: [os.tmpdir()] })).rejects.toThrow(/démo/);
    await expect(call(rt, 'repositories.inspect', { path: os.tmpdir() })).rejects.toThrow(/démo/);
  });

  it('keeps demo data away from real services: no pull request, no gateway', async () => {
    await expect(call(rt, 'pullRequests.create', { taskId: 'task_demo_cc88' })).rejects.toThrow(/démo/);
    await expect(call(rt, 'remote.enable', { gatewayUrl: 'http://localhost:1' })).rejects.toThrow(/démo/);
    await expect(call(rt, 'remote.pairingStart', {})).rejects.toThrow(/démo/);
    expect((await call(rt, 'remote.status', {})).enabled).toBe(false);
  });

  it('runs a scripted task through a real approval', async () => {
    const { sessions: [session] } = await call(rt, 'tasks.start', { taskId: DEMO_LIVE_TASK_ID });
    await waitFor(async () => (await call(rt, 'approvals.list', { status: 'pending' })).length === 1);
    const [pending] = await call(rt, 'approvals.list', { status: 'pending' });
    expect(pending?.summary).toContain('InventoryGrid.cs');
    expect((await call(rt, 'tasks.get', { taskId: DEMO_LIVE_TASK_ID })).status).toBe('waiting_approval');
    await call(rt, 'approvals.resolve', { approvalId: pending!.id, decision: 'approve' });
    await waitFor(async () => (await call(rt, 'sessions.get', { sessionId: session!.id })).session.status === 'idle');
    const { entries } = await call(rt, 'sessions.get', { sessionId: session!.id });
    expect(entries.filter((e) => e.kind === 'tool_call').map((e) => (e as { status: string }).status)).toEqual(['completed', 'completed']);
    expect((await call(rt, 'tasks.get', { taskId: DEMO_LIVE_TASK_ID })).status).toBe('review');
  });

  it('resumes a seeded session with a follow-up turn', async () => {
    await call(rt, 'sessions.send', { sessionId: 'ses_demo_cc91', text: 'Ajoute un test de charge' });
    await waitFor(async () => (await call(rt, 'approvals.list', { status: 'pending' })).length === 1);
    const [pending] = await call(rt, 'approvals.list', { status: 'pending' });
    await call(rt, 'approvals.resolve', { approvalId: pending!.id, decision: 'reject' });
    await waitFor(async () => (await call(rt, 'sessions.get', { sessionId: 'ses_demo_cc91' })).session.status === 'idle');
    const { entries } = await call(rt, 'sessions.get', { sessionId: 'ses_demo_cc91' });
    expect(entries.filter((e) => e.kind === 'tool_call').at(-1)).toMatchObject({ status: 'denied' });
  });
});

describe('demo runtime, new tasks', () => {
  let rt: Runtime;
  beforeAll(async () => {
    rt = await createRuntime({ dataDir: ':memory:', demo: true, demoStepMs: 0, detectProviders: false, logger });
    await rt.services.providers.detectAll();
  });
  afterAll(() => rt.shutdown());

  it('runs without worktrees, and in auto mode without asking', async () => {
    const task = await call(rt, 'tasks.create', { workspaceId: 'ws_demo_codeo_cloud', title: 'Pagination des factures', provider: 'codex' });
    expect(task.isolation).toBe('none');
    expect(task.subtasks[0]?.assignment.executionMode).toBe('auto');
    const { sessions: [session] } = await call(rt, 'tasks.start', { taskId: task.id });
    expect(session?.cwd).toBe('demo://codeo-cloud');
    await waitFor(async () => (await call(rt, 'sessions.get', { sessionId: session!.id })).session.status === 'idle');
    expect(await call(rt, 'approvals.list', { status: 'pending' })).toEqual([]);
    expect(await call(rt, 'worktrees.list', { taskId: task.id })).toEqual([]);
    expect((await call(rt, 'tasks.get', { taskId: task.id })).status).toBe('review');
  });
});

describe('demo dataset upgrade', () => {
  it('adds the review lanes and pull requests to a database seeded by the first version, keeping the rest', async () => {
    const db = await openDatabase({ file: ':memory:' });
    const repos = {
      settings: new SettingsRepo(db.db),
      workspaces: new WorkspaceRepo(db.db),
      tasks: new TaskRepo(db.db),
      sessions: new SessionRepo(db.db),
      approvals: new ApprovalRepo(db.db),
      worktrees: new WorktreeRepo(db.db),
      pullRequests: new PullRequestRepo(db.db),
    };
    /* What version 1 wrote: no lanes, no pull requests, every task in place. */
    const d = buildDemoDataset('mac_demo');
    for (const ws of d.workspaces) await repos.workspaces.insert(ws);
    for (const s of d.sessions.filter((x) => x.id !== 'ses_demo_ely136')) await repos.sessions.upsert({ ...s, cwd: 'demo://elyndor/elyndor-unity', worktreeId: null, subtaskId: null });
    for (const t of d.tasks.filter((x) => x.id !== 'task_demo_ely136')) await repos.tasks.upsert({ ...t, isolation: 'none', subtasks: t.subtasks.map((s) => ({ ...s, worktreeId: null })) });
    const userTask = { ...d.tasks.find((t) => t.id === 'task_demo_ely170')!, title: 'Renommée pendant la démo' };
    await repos.tasks.upsert(userTask);
    await repos.settings.set('demoSeeded', true);

    expect(await seedDemoData(repos, 'mac_demo')).toBe(false);
    expect(await repos.settings.get('demoSeeded', 0)).toBe(DEMO_DATASET_VERSION);
    expect((await repos.worktrees.list()).length).toBe(d.worktrees.length);
    expect((await repos.pullRequests.list()).length).toBe(d.pullRequests.length);
    expect((await repos.tasks.get('task_demo_ely142'))?.isolation).toBe('worktree');
    expect((await repos.sessions.get('ses_demo_cc91'))?.worktreeId).toBe('wt_demo_cc91');
    expect((await repos.sessions.entries('ses_demo_ely136')).length).toBeGreaterThan(0);
    /* Tasks without a lane keep what was done in the demo. */
    expect((await repos.tasks.get('task_demo_ely170'))?.title).toBe('Renommée pendant la démo');
    /* Idempotent. */
    expect(await seedDemoData(repos, 'mac_demo')).toBe(false);
    expect((await repos.sessions.entries('ses_demo_ely136')).length).toBe(d.entries.filter((e) => e.sessionId === 'ses_demo_ely136').length);
    db.close();
  });
});

describe('demo / live data separation', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'codeo-demo-'));
  });
  /* Windows keeps handles on the closed SQLite files briefly: retry, and never fail the suite on cleanup (as runtime.test.ts). */
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (err) {
      console.warn(`cleanup of ${dir} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  it('seeds once and never opens the same data in the other mode', async () => {
    const demoDir = path.join(dir, 'demo');
    const liveDir = path.join(dir, 'live');
    mkdirSync(demoDir);
    mkdirSync(liveDir);
    const first = await createRuntime({ dataDir: demoDir, demo: true, detectProviders: false, logger });
    await first.shutdown();
    const again = await createRuntime({ dataDir: demoDir, demo: true, detectProviders: false, logger });
    expect((await call(again, 'workspaces.list', {})).length).toBe(2);
    await again.shutdown();
    await expect(createRuntime({ dataDir: demoDir, detectProviders: false, logger })).rejects.toThrow(/démonstration/);

    const live = await createRuntime({ dataDir: liveDir, detectProviders: false, providers: [], logger });
    expect(live.info.demoMode).toBe(false);
    expect(await call(live, 'workspaces.list', {})).toEqual([]);
    await live.shutdown();
    await expect(createRuntime({ dataDir: liveDir, demo: true, detectProviders: false, logger })).rejects.toThrow(/réelles/);
  });
});
