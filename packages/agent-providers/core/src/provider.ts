import type { AgentProviderId, AgentRole, ExecutionMode, ProviderStatus, RiskLevel } from '@codeo/domain';
import type { Logger } from '@codeo/shared-utils';

/** Normalised events every adapter emits — never a provider wire format. */
export type ProviderEvent =
  | { type: 'session_started'; providerSessionId: string; model: string | null }
  | { type: 'status'; state: 'running' | 'idle' | 'requires_action' }
  | { type: 'text_delta'; blockId: string; delta: string }
  | { type: 'text_complete'; blockId: string; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call_started'; toolUseId: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_call_completed'; toolUseId: string; output: string | null; isError: boolean }
  | { type: 'tool_call_denied'; toolUseId: string; reason: string }
  | { type: 'system'; text: string; level: 'info' | 'warn' | 'error' }
  | {
      type: 'turn_completed';
      ok: boolean;
      summary: string;
      durationMs: number | null;
      costUsd: number | null;
      turns: number | null;
    }
  | { type: 'error'; message: string; fatal: boolean };

export interface PermissionRequest {
  providerRequestId: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  affected: string[];
  risk: RiskLevel;
  reason: string | null;
  signal: AbortSignal;
}
export type PermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

export interface StartSessionOptions {
  cwd: string;
  role: AgentRole;
  roleInstructions: string;
  model: string | null;
  /** How autonomously this session runs; the adapter maps it to its provider's native policy. */
  executionMode: ExecutionMode;
  /** Provider session/thread id to resume; null starts fresh. */
  resumeProviderSessionId: string | null;
  onEvent: (event: ProviderEvent) => void;
  /** Called when the agent needs a human decision; must resolve (or the tool is blocked). */
  onPermissionRequest: (request: PermissionRequest) => Promise<PermissionDecision>;
  logger: Logger;
}

export interface ProviderSessionHandle {
  readonly providerSessionId: string | null;
  /** Queue a user turn. Resolves when accepted (not when the turn completes). */
  send(text: string): Promise<void>;
  /** Interrupt the running turn; the session stays resumable. */
  interrupt(): Promise<void>;
  /** Terminate the underlying process and release resources. */
  close(): Promise<void>;
}

export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly displayName: string;
  detect(): Promise<ProviderStatus>;
  startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: AgentProviderId,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
