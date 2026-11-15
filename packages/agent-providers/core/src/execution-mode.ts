import type { AgentProviderId, ExecutionMode } from '@codeo/domain';

/**
 * Native settings each provider adapter applies for a given execution mode.
 * Codeo never implements its own permission engine: it only selects the provider's
 * NATIVE policy. Values here are the string literals the official SDKs accept.
 */

/** Claude Code native permission mode (subset of the SDK's `permissionMode`). */
export type ClaudePermissionMode = 'default' | 'auto' | 'bypassPermissions';

/** Codex native sandbox mode (the SDK's `ThreadOptions['sandboxMode']`). */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Map an execution mode to Claude Code's native `permissionMode`.
 *  - `manual` → `default`: every sensitive tool goes through `canUseTool` (Codeo approvals).
 *  - `auto` → `auto`: Claude Code's native auto mode — its classifier approves or denies each
 *    call and only escalates through `canUseTool` (Codeo approvals) when it cannot decide.
 *    (`acceptEdits` would still prompt for every shell command.)
 *  - `full` → `bypassPermissions`: explicit opt-in unattended run.
 */
export function claudePermissionMode(mode: ExecutionMode): ClaudePermissionMode {
  switch (mode) {
    case 'manual':
      return 'default';
    case 'auto':
      return 'auto';
    case 'full':
      return 'bypassPermissions';
  }
}

/**
 * Map an execution mode to Codex's native `sandboxMode`. Codex runs non-interactively
 * (`codex exec`): it has no per-tool approval callback, so its sandbox is the whole policy.
 *  - `manual` → `read-only`: the agent cannot write, matching "ask before any change".
 *  - `auto` → `workspace-write`: edits within the workspace, network still restricted; escalations
 *    out of the sandbox go to Codex's auto-review agent (see `codexApprovalSettings`).
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

/** Codex native approval settings: the SDK's `approvalPolicy` plus `--config` overrides. */
export interface CodexApprovalSettings {
  approvalPolicy: 'never' | 'on-request';
  config: { approvals_reviewer?: 'auto_review' };
}

/**
 * Map an execution mode to Codex's native approval settings. `codex exec` cannot ask a human,
 * so Codeo never lets Codex wait for one:
 *  - `manual` / `full` → `never`: no escalation is requested; the sandbox alone decides.
 *  - `auto` → `on-request` reviewed by `approvals_reviewer = "auto_review"`: when a command needs
 *    to leave the `workspace-write` sandbox (network, writes outside the workspace), Codex's own
 *    reviewer agent allows or denies it — the counterpart of Claude Code's auto-mode classifier.
 *    A denied escalation is reported back to the agent, which continues with a safer path.
 */
export function codexApprovalSettings(mode: ExecutionMode): CodexApprovalSettings {
  return mode === 'auto' ? { approvalPolicy: 'on-request', config: { approvals_reviewer: 'auto_review' } } : { approvalPolicy: 'never', config: {} };
}

/** Every execution mode, in increasing autonomy — the UI iterates this order. */
export const EXECUTION_MODES: readonly ExecutionMode[] = ['manual', 'auto', 'full'] as const;

/**
 * Whether a provider can escalate individual sensitive actions to a human *within* a mode.
 * Claude Code routes sensitive tools through `canUseTool` (Codeo approvals). Codex runs
 * non-interactively (`codex exec`): nothing reaches a human — in `auto` its own reviewer settles
 * sandbox escalations, otherwise the sandbox is the whole policy.
 */
export function supportsPerActionEscalation(provider: AgentProviderId): boolean {
  return provider === 'claude-code';
}

