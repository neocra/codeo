import type { OrchestrationMode, Subtask, SubtaskStatus, Task, TaskStatus } from './entities';

/**
 * Pure scheduling rules of the orchestration engine. The runtime applies them; keeping
 * them here makes every mode testable without processes, git or providers.
 *
 * - single:     one subtask.
 * - sequential: steps run one after another in a shared worktree.
 * - pipeline:   like sequential, and each step receives the previous steps' output.
 * - parallel:   subtasks run concurrently, each in its own worktree; explicit `dependsOn` forms a DAG.
 * - best-of-n:  N agents attempt the same objective in separate worktrees; the human picks one.
 */
export const MAX_PARALLEL_SUBTASKS = 4;

const ACTIVE: readonly SubtaskStatus[] = ['running', 'waiting_approval'];
const DEAD: readonly SubtaskStatus[] = ['failed', 'cancelled'];

type Plan = Pick<Task, 'orchestration' | 'subtasks'>;

export const isChained = (mode: OrchestrationMode): boolean => mode === 'sequential' || mode === 'pipeline';

/** Chained modes (and single) share one worktree per repository; parallel modes isolate each subtask. */
export const sharesWorktree = (mode: OrchestrationMode): boolean => mode === 'single' || isChained(mode);

export const orderedSubtasks = (plan: Plan): Subtask[] => [...plan.subtasks].sort((a, b) => a.order - b.order);

/** Effective dependencies: explicit `dependsOn`, plus the previous step in chained modes. */
export function subtaskDependencies(plan: Plan, sub: Subtask): string[] {
  const deps = new Set(sub.dependsOn);
  if (isChained(plan.orchestration)) {
    const ordered = orderedSubtasks(plan);
    const prev = ordered[ordered.findIndex((s) => s.id === sub.id) - 1];
    if (prev) deps.add(prev.id);
  }
  return [...deps];
}

/** Pending subtasks whose dependencies are all completed, within the concurrency budget. */
export function runnableSubtasks(plan: Plan, maxParallel = MAX_PARALLEL_SUBTASKS): Subtask[] {
  const byId = new Map(plan.subtasks.map((s) => [s.id, s]));
  const slots = maxParallel - plan.subtasks.filter((s) => ACTIVE.includes(s.status)).length;
  if (slots <= 0) return [];
  return orderedSubtasks(plan)
    .filter((s) => s.status === 'pending' && subtaskDependencies(plan, s).every((d) => byId.get(d)?.status === 'completed'))
    .slice(0, slots);
}

/** Pending subtasks that can never run: a dependency (direct or transitive) failed, was cancelled or is missing. */
export function blockedSubtasks(plan: Plan): Subtask[] {
  const byId = new Map(plan.subtasks.map((s) => [s.id, s]));
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of plan.subtasks) {
      if (s.status !== 'pending' || blocked.has(s.id)) continue;
      const dead = subtaskDependencies(plan, s).some((d) => {
        const dep = byId.get(d);
        return !dep || DEAD.includes(dep.status) || blocked.has(d);
      });
      if (dead) {
        blocked.add(s.id);
        changed = true;
      }
    }
  }
  return plan.subtasks.filter((s) => blocked.has(s.id));
}

/**
 * The task status implied by its subtasks. A task stays running while any candidate is still
 * pending or running; once every subtask has settled, Best-of-N reaches review if at least one
 * candidate completed (the human picks one), other modes fail when any subtask failed.
 */
export function aggregateTaskStatus(plan: Plan): TaskStatus {
  const statuses = plan.subtasks.map((s) => s.status);
  if (statuses.includes('waiting_approval')) return 'waiting_approval';
  if (statuses.includes('running') || statuses.includes('pending')) return 'running';
  const completed = statuses.filter((s) => s === 'completed').length;
  if (statuses.length > 0 && completed === statuses.length) return 'review';
  if (plan.orchestration === 'best-of-n') return completed > 0 ? 'review' : statuses.includes('failed') ? 'failed' : 'cancelled';
  if (statuses.includes('failed')) return 'failed';
  /* Every step of a plan is required: a settled cancellation cancels the task (partial success is Best-of-N only). */
  return 'cancelled';
}

/** 0–90: the last 10 % belong to the human review. */
export function taskProgress(plan: Plan): number {
  if (!plan.subtasks.length) return 0;
  const finished = plan.subtasks.filter((s) => s.status === 'completed' || DEAD.includes(s.status)).length;
  const active = plan.subtasks.filter((s) => ACTIVE.includes(s.status)).length;
  return Math.round((90 * (finished + active * 0.15)) / plan.subtasks.length);
}
