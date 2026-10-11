import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase, SessionRepo, WorkspaceRepo, EventRepo, WorktreeRepo } from '../src/index';

let opened: OpenedDatabase;
beforeAll(async () => {
  opened = await openDatabase({ file: ':memory:' });
});
afterAll(() => opened.close());

const now = new Date().toISOString();

describe('database', () => {
  it('persists workspaces with repositories', async () => {
    const repo = new WorkspaceRepo(opened.db);
    await repo.insert({
      id: 'ws_1',
      machineId: 'mac_1',
      name: 'Elyndor',
      description: '',
      type: 'multi-repo',
      defaultProvider: 'claude-code',
      createdAt: now,
      updatedAt: now,
      repositories: [{ id: 'repo_1', workspaceId: 'ws_1', name: 'elyndor-unity', path: '/tmp/elyndor-unity', defaultBranch: 'main', remoteUrl: null, services: [], createdAt: now }],
    });
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.repositories[0]?.name).toBe('elyndor-unity');
  });

  it('appends and reads session entries in order', async () => {
    const sessions = new SessionRepo(opened.db);
    await sessions.upsert({
      id: 'ses_1', workspaceId: 'ws_1', taskId: null, subtaskId: null, repositoryId: null, worktreeId: null,
      provider: 'claude-code', role: 'developer', title: 'Test', status: 'running', providerSessionId: null,
      cwd: '/tmp', model: null, error: null, createdAt: now, updatedAt: now, lastActivityAt: now,
    });
    await sessions.appendEntry({ kind: 'user_message', id: 'ent_1', sessionId: 'ses_1', seq: 1, at: now, text: 'Bonjour' });
    await sessions.appendEntry({ kind: 'assistant_text', id: 'ent_2', sessionId: 'ses_1', seq: 2, at: now, text: 'Salut', streaming: false });
    const entries = await sessions.entries('ses_1');
    expect(entries.map((e) => e.kind)).toEqual(['user_message', 'assistant_text']);
    expect(await sessions.lastSeq('ses_1')).toBe(2);
    expect(await sessions.entries('ses_1', 1)).toHaveLength(1);
  });

  it('finds worktrees by task lane', async () => {
    const worktrees = new WorktreeRepo(opened.db);
    const base = { workspaceId: 'ws_1', repositoryId: 'repo_1', taskId: 'task_1', baseBranch: 'main', dirty: false, createdAt: now };
    await worktrees.insert({ ...base, id: 'wt_shared', subtaskId: null, path: '/tmp/wt/shared', branch: 'codeo/a' });
    await worktrees.insert({ ...base, id: 'wt_lane', subtaskId: 'sub_2', path: '/tmp/wt/lane', branch: 'codeo/a-2' });
    expect((await worktrees.findLane('task_1', 'repo_1', null))?.id).toBe('wt_shared');
    expect((await worktrees.findLane('task_1', 'repo_1', 'sub_2'))?.id).toBe('wt_lane');
    expect(await worktrees.findLane('task_1', 'repo_1', 'sub_9')).toBeNull();
    expect(await worktrees.list({ taskId: 'task_1' })).toHaveLength(2);
    await worktrees.delete('wt_lane');
    expect(await worktrees.list({ workspaceId: 'ws_1' })).toHaveLength(1);
  });

  it('assigns monotonic sequence numbers to events', async () => {
    const events = new EventRepo(opened.db);
    const a = await events.append({ id: 'evt_1', type: 'RuntimeReady', at: now }, { type: 'RuntimeReady' });
    const b = await events.append({ id: 'evt_2', type: 'RuntimeReady', at: now }, { type: 'RuntimeReady' });
    expect(b).toBe(a + 1);
    expect(await events.after(a)).toHaveLength(1);
  });
});
