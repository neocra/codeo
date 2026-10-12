import { describe, expect, it } from 'vitest';
import type { OrchestrationMode, Subtask, SubtaskStatus } from '../src/entities';
import { aggregateTaskStatus, blockedSubtasks, runnableSubtasks, sharesWorktree, subtaskDependencies, taskProgress } from '../src/orchestration';
import { taskTransitionPath } from '../src/state-machines';

const sub = (id: string, order: number, status: SubtaskStatus = 'pending', dependsOn: string[] = []): Subtask => ({
  id,
  taskId: 'task_1',
  title: id,
  instructions: '',
  assignment: { role: 'developer', provider: 'claude-code', model: null },
  repositoryId: null,
  dependsOn,
  status,
  sessionId: null,
  worktreeId: null,
  error: null,
  attemptStartedAt: null,
  order,
});
const plan = (orchestration: OrchestrationMode, subtasks: Subtask[]) => ({ orchestration, subtasks });
const ids = (list: Subtask[]) => list.map((s) => s.id);

describe('dependencies and scheduling', () => {
  it('chains steps in sequential and pipeline modes', () => {
    for (const mode of ['sequential', 'pipeline'] as const) {
      const p = plan(mode, [sub('s_b', 1), sub('s_a', 0), sub('s_c', 2)]);
      expect(subtaskDependencies(p, p.subtasks[0]!)).toEqual(['s_a']);
      expect(ids(runnableSubtasks(p))).toEqual(['s_a']);
    }
  });

  it('starts the next step only when the previous one completed', () => {
    const p = plan('sequential', [sub('s_a', 0, 'completed'), sub('s_b', 1), sub('s_c', 2)]);
    expect(ids(runnableSubtasks(p))).toEqual(['s_b']);
  });

  it('runs independent parallel subtasks together, within the concurrency budget', () => {
    const p = plan('parallel', [sub('s_a', 0), sub('s_b', 1), sub('s_c', 2, 'pending', ['s_a'])]);
    expect(ids(runnableSubtasks(p))).toEqual(['s_a', 's_b']);
    expect(ids(runnableSubtasks(p, 1))).toEqual(['s_a']);
    const busy = plan('parallel', [sub('s_a', 0, 'running'), sub('s_b', 1, 'waiting_approval'), sub('s_c', 2)]);
    expect(runnableSubtasks(busy, 2)).toEqual([]);
  });

  it('blocks dependents of a failed subtask, transitively', () => {
    const p = plan('parallel', [sub('s_a', 0, 'failed'), sub('s_b', 1, 'pending', ['s_a']), sub('s_c', 2, 'pending', ['s_b']), sub('s_d', 3)]);
    expect(ids(blockedSubtasks(p))).toEqual(['s_b', 's_c']);
    expect(ids(blockedSubtasks(plan('sequential', [sub('s_a', 0, 'cancelled'), sub('s_b', 1)])))).toEqual(['s_b']);
  });

  it('isolates each subtask only in parallel modes', () => {
    expect(sharesWorktree('single')).toBe(true);
    expect(sharesWorktree('pipeline')).toBe(true);
    expect(sharesWorktree('parallel')).toBe(false);
    expect(sharesWorktree('best-of-n')).toBe(false);
  });
});

describe('aggregate task status', () => {
  it('surfaces approvals first, then activity', () => {
    expect(aggregateTaskStatus(plan('parallel', [sub('s_a', 0, 'running'), sub('s_b', 1, 'waiting_approval')]))).toBe('waiting_approval');
    expect(aggregateTaskStatus(plan('sequential', [sub('s_a', 0, 'completed'), sub('s_b', 1)]))).toBe('running');
  });
  it('goes to review when all work is done', () => {
    expect(aggregateTaskStatus(plan('parallel', [sub('s_a', 0, 'completed'), sub('s_b', 1, 'completed')]))).toBe('review');
  });
  it('fails when a subtask failed, except best-of-n with a surviving candidate', () => {
    const mixed = [sub('s_a', 0, 'completed'), sub('s_b', 1, 'failed')];
    expect(aggregateTaskStatus(plan('parallel', mixed))).toBe('failed');
    expect(aggregateTaskStatus(plan('best-of-n', mixed))).toBe('review');
    expect(aggregateTaskStatus(plan('best-of-n', [sub('s_a', 0, 'failed'), sub('s_b', 1, 'cancelled')]))).toBe('failed');
  });
  it('is cancelled when nothing completed and nothing failed', () => {
    expect(aggregateTaskStatus(plan('parallel', [sub('s_a', 0, 'cancelled')]))).toBe('cancelled');
  });
  it('reports progress up to 90 %', () => {
    expect(taskProgress(plan('parallel', [sub('s_a', 0, 'completed'), sub('s_b', 1, 'completed')]))).toBe(90);
    expect(taskProgress(plan('parallel', [sub('s_a', 0, 'completed'), sub('s_b', 1)]))).toBe(45);
  });
});

describe('taskTransitionPath', () => {
  it('finds legal intermediate states', () => {
    expect(taskTransitionPath('waiting_approval', 'review')).toEqual(['running', 'review']);
    expect(taskTransitionPath('failed', 'running')).toEqual(['queued', 'running']);
    expect(taskTransitionPath('running', 'running')).toEqual([]);
  });
  it('never revives a terminal task', () => {
    expect(taskTransitionPath('completed', 'running')).toBeNull();
    expect(taskTransitionPath('cancelled', 'review')).toBeNull();
  });
});
