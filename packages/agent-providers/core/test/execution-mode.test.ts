import { describe, expect, it } from 'vitest';
import { claudePermissionMode, codexSandboxMode, EXECUTION_MODES, supportsPerActionEscalation } from '../src/execution-mode';

describe('execution mode → native provider policy', () => {
  it('maps every mode to a Claude permission mode', () => {
    expect(claudePermissionMode('manual')).toBe('default');
    expect(claudePermissionMode('auto')).toBe('acceptEdits');
    expect(claudePermissionMode('full')).toBe('bypassPermissions');
  });

  it('maps every mode to a Codex sandbox mode', () => {
    expect(codexSandboxMode('manual')).toBe('read-only');
    expect(codexSandboxMode('auto')).toBe('workspace-write');
    expect(codexSandboxMode('full')).toBe('danger-full-access');
  });

  it('keeps manual mode read-only / approval-gated on both providers', () => {
    // Security boundary: manual must never grant write access without approval.
    expect(claudePermissionMode('manual')).toBe('default');
    expect(codexSandboxMode('manual')).toBe('read-only');
  });

  it('reserves full filesystem access for the explicit full mode', () => {
    // Only `full` may bypass the sandbox / approval policy.
    for (const mode of EXECUTION_MODES) {
      const bypasses = claudePermissionMode(mode) === 'bypassPermissions' || codexSandboxMode(mode) === 'danger-full-access';
      expect(bypasses).toBe(mode === 'full');
    }
  });

  it('covers exactly the three defined modes', () => {
    expect(EXECUTION_MODES).toEqual(['manual', 'auto', 'full']);
  });
});

describe('supportsPerActionEscalation', () => {
  it('reports per-action escalation only for Claude Code', () => {
    expect(supportsPerActionEscalation('claude-code')).toBe(true);
    expect(supportsPerActionEscalation('codex')).toBe(false);
  });
});
