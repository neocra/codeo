import { describe, expect, it } from 'vitest';
import { approvalTransition, InvalidTransitionError, sessionTransition, taskTransition } from '../src/state-machines';

describe('task state machine', () => {
  it('allows the nominal lifecycle', () => {
    let s = taskTransition('draft', 'queued');
    s = taskTransition(s, 'running');
    s = taskTransition(s, 'waiting_approval');
    s = taskTransition(s, 'running');
    s = taskTransition(s, 'review');
    expect(taskTransition(s, 'completed')).toBe('completed');
  });
  it('never lets a completed task silently run again', () => {
    expect(() => taskTransition('completed', 'running')).toThrow(InvalidTransitionError);
  });
});

describe('session state machine', () => {
  it('cancelled sessions cannot go to waiting_approval', () => {
    expect(() => sessionTransition('cancelled', 'waiting_approval')).toThrow(InvalidTransitionError);
  });
  it('a completed session can be resumed explicitly', () => {
    expect(sessionTransition('completed', 'running')).toBe('running');
  });
});

describe('approval state machine', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  it('approves a pending, unexpired request', () => {
    expect(approvalTransition({ status: 'pending', expiresAt: future }, 'approved')).toBe('approved');
  });
  it('refuses to approve an expired request', () => {
    expect(() => approvalTransition({ status: 'pending', expiresAt: past }, 'approved')).toThrow(/expired/);
  });
  it('refuses double decisions', () => {
    expect(() => approvalTransition({ status: 'approved', expiresAt: future }, 'rejected')).toThrow(InvalidTransitionError);
  });
});
