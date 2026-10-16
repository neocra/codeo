import { describe, expect, it } from 'vitest';
import { AgentAssignmentSchema, AgentSessionSchema, legacyExecutionMode } from '../src';

describe('legacy execution mode', () => {
  it('keeps the policy each provider ran under before execution modes existed', () => {
    expect(legacyExecutionMode('claude-code')).toBe('manual');
    expect(legacyExecutionMode('codex')).toBe('auto');
  });

  it('fills a missing assignment mode from its provider and keeps an explicit one', () => {
    expect(AgentAssignmentSchema.parse({ role: 'developer', provider: 'claude-code' }).executionMode).toBe('manual');
    expect(AgentAssignmentSchema.parse({ role: 'developer', provider: 'codex' }).executionMode).toBe('auto');
    expect(AgentAssignmentSchema.parse({ role: 'developer', provider: 'claude-code', executionMode: 'full' }).executionMode).toBe('full');
  });

  it('fills a missing session mode from its provider', () => {
    const now = new Date().toISOString();
    const session = { id: 'ses_1', workspaceId: 'ws_1', provider: 'claude-code', role: 'developer', title: 't', status: 'idle', cwd: '/tmp', createdAt: now, updatedAt: now, lastActivityAt: now };
    expect(AgentSessionSchema.parse(session).executionMode).toBe('manual');
  });
});
