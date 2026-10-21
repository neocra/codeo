import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSessionSchema, ApprovalRequestSchema, SessionEntrySchema, TaskSchema, WorkspaceSchema } from '@codeo/domain';
import { createLogger } from '@codeo/shared-utils';
import { buildDemoDataset, DEMO_LIVE_TASK_ID } from '../src/demo/dataset';
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
    expect((await call(rt, 'tasks.list', {})).length).toBe(7);
    const { entries } = await call(rt, 'sessions.get', { sessionId: 'ses_demo_ely142' });
    expect(entries.at(-1)?.kind).toBe('result');
    const providers = await call(rt, 'providers.list', {});
    expect(providers.map((p) => [p.provider, p.version, p.executable])).toEqual([
      ['claude-code', 'demo', null],
      ['codex', 'demo', null],
    ]);
  });

  it('refuses real repositories', async () => {
    await expect(call(rt, 'workspaces.create', { name: 'Réel', type: 'multi-repo', repositoryPaths: [os.tmpdir()] })).rejects.toThrow(/démo/);
    await expect(call(rt, 'repositories.inspect', { path: os.tmpdir() })).rejects.toThrow(/démo/);
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
    expect(await call(rt, 'worktrees.list', {})).toEqual([]);
    expect((await call(rt, 'tasks.get', { taskId: task.id })).status).toBe('review');
  });
});

describe('demo / live data separation', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'codeo-demo-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
