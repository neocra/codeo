import type { AgentProviderId, ExecutionMode } from '@codeo/domain';

/**
 * Native settings each provider adapter applies for a given execution mode.
 * Codeo never implements its own permission engine: it only selects the provider's
 * NATIVE policy. Values here are the string literals the official SDKs accept.
 */

/** Claude Code native permission mode (subset of the SDK's `permissionMode`). */
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** Codex native sandbox mode (the SDK's `ThreadOptions['sandboxMode']`). */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Map an execution mode to Claude Code's native `permissionMode`.
 *  - `manual` → `default`: every sensitive tool goes through `canUseTool` (Codeo approvals).
 *  - `auto` → `acceptEdits`: edits auto-approved, other sensitive tools still escalate.
 *  - `full` → `bypassPermissions`: explicit opt-in unattended run.
 */
export function claudePermissionMode(mode: ExecutionMode): ClaudePermissionMode {
  switch (mode) {
    case 'manual':
      return 'default';
    case 'auto':
      return 'acceptEdits';
    case 'full':
      return 'bypassPermissions';
  }
}

/**
 * Map an execution mode to Codex's native `sandboxMode`. Codex runs non-interactively
 * (`codex exec`): it has no per-tool approval callback, so its sandbox is the whole policy.
 *  - `manual` → `read-only`: the agent cannot write, matching "ask before any change".
 *  - `auto` → `workspace-write`: edits within the workspace, network still restricted.
 *  - `full` → `danger-full-access`: explicit opt-in unattended run.
 */
export function codexSandboxMode(mode: ExecutionMode): CodexSandboxMode {
  switch (mode) {
    case 'manual':
      return 'read-only';
    case 'auto':
      return 'workspace-write';
    case 'full':
      return 'danger-full-access';
  }
}

/** Every execution mode, in increasing autonomy — the UI iterates this order. */
export const EXECUTION_MODES: readonly ExecutionMode[] = ['manual', 'auto', 'full'] as const;

/**
 * Whether a provider can escalate individual sensitive actions to a human *within* a mode.
 * Claude Code routes sensitive tools through `canUseTool` (Codeo approvals). Codex runs
 * non-interactively (`codex exec`): its sandbox is the whole policy, so there is no
 * per-action escalation — `auto`/`manual` degrade to the sandbox boundary instead.
 */
export function supportsPerActionEscalation(provider: AgentProviderId): boolean {
  return provider === 'claude-code';
}

