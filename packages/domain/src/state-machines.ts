import type { ApprovalRequest, SessionStatus, TaskStatus } from './entities';

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity}: transition ${from} → ${to} is not allowed`);
    this.name = 'InvalidTransitionError';
  }
}

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'paused', 'review', 'completed', 'failed', 'cancelled'],
  waiting_approval: ['running', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  review: ['running', 'completed', 'cancelled'],
  completed: [],
  failed: ['queued'],
  cancelled: [],
};

const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  created: ['running', 'failed', 'cancelled'],
  running: ['waiting_approval', 'idle', 'completed', 'failed', 'cancelled', 'disconnected'],
  waiting_approval: ['running', 'failed', 'cancelled', 'disconnected'],
  idle: ['running', 'completed', 'cancelled', 'disconnected'],
  completed: ['running'],
  failed: ['running'],
  cancelled: ['running'],
  /* `completed` closes a disconnected session cleanly (e.g. its reviewed worktree is removed after a restart). */
  disconnected: ['running', 'failed', 'completed'],
};

const APPROVAL_TRANSITIONS: Record<ApprovalRequest['status'], readonly ApprovalRequest['status'][]> = {
  pending: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

function check<S extends string>(entity: string, table: Record<S, readonly S[]>, from: S, to: S): S {
  if (from === to) return to;
  if (!table[from].includes(to)) throw new InvalidTransitionError(entity, from, to);
  return to;
}

export const taskTransition = (from: TaskStatus, to: TaskStatus): TaskStatus =>
  check('Task', TASK_TRANSITIONS, from, to);
export const sessionTransition = (from: SessionStatus, to: SessionStatus): SessionStatus =>
  check('Session', SESSION_TRANSITIONS, from, to);
export const canTransitionTask = (from: TaskStatus, to: TaskStatus): boolean =>
  from === to || TASK_TRANSITIONS[from].includes(to);
export const canTransitionSession = (from: SessionStatus, to: SessionStatus): boolean =>
  from === to || SESSION_TRANSITIONS[from].includes(to);

/**
 * Shortest legal route between two task statuses (excluding `from`), or null. Lets an
 * aggregator that observed several subtask changes at once (e.g. `waiting_approval` →
 * `review`) move through the intermediate states instead of breaking the machine.
 */
export function taskTransitionPath(from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) return [];
  const prev = new Map<TaskStatus, TaskStatus>();
  const queue: TaskStatus[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of TASK_TRANSITIONS[cur]) {
      if (next === from || prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path: TaskStatus[] = [to];
        for (let s = cur; s !== from; s = prev.get(s)!) path.unshift(s);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Approval decisions must respect expiry — an expired request can never be accepted. */
export function approvalTransition(
  approval: Pick<ApprovalRequest, 'status' | 'expiresAt'>,
  to: ApprovalRequest['status'],
  now: Date = new Date(),
): ApprovalRequest['status'] {
  if ((to === 'approved' || to === 'rejected') && approval.status === 'pending') {
    if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
      throw new InvalidTransitionError('Approval', 'pending', `${to} (expired)`);
    }
  }
  return check('Approval', APPROVAL_TRANSITIONS, approval.status, to);
}

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];
export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = ['running', 'waiting_approval'];
