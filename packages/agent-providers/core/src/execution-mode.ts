import type { ExecutionMode } from '@codeo/domain';

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
