import type { AgentSession, ApprovalRequest, Task } from '@codeo/domain';
import type { Tone } from '@codeo/ui-desktop';
import type { MessageKey } from '@codeo/i18n';

export function sessionTone(status: AgentSession['status']): { tone: Tone; key: MessageKey } {
  switch (status) {
    case 'running':
      return { tone: 'live', key: 'status.sessionActive' };
    case 'waiting_approval':
      return { tone: 'attention', key: 'status.waitingApproval' };
    case 'created':
      return { tone: 'waiting', key: 'status.created' };
    case 'idle':
      return { tone: 'waiting', key: 'status.idle' };
    case 'completed':
      return { tone: 'done', key: 'status.done' };
    case 'failed':
      return { tone: 'error', key: 'status.failed' };
    case 'cancelled':
      return { tone: 'idle', key: 'status.cancelled' };
    case 'disconnected':
      return { tone: 'idle', key: 'status.disconnected' };
  }
}

export function taskTone(status: Task['status']): { tone: Tone; key: MessageKey } {
  switch (status) {
    case 'running':
      return { tone: 'live', key: 'status.running' };
    case 'waiting_approval':
      return { tone: 'attention', key: 'status.waitingApproval' };
    case 'review':
      return { tone: 'attention', key: 'status.review' };
    case 'queued':
      return { tone: 'waiting', key: 'status.queued' };
    case 'paused':
      return { tone: 'waiting', key: 'status.paused' };
    case 'draft':
      return { tone: 'idle', key: 'status.draft' };
    case 'completed':
      return { tone: 'done', key: 'status.completed' };
    case 'failed':
      return { tone: 'error', key: 'status.failed' };
    case 'cancelled':
      return { tone: 'idle', key: 'status.cancelled' };
  }
}

export function approvalKindKey(a: ApprovalRequest): MessageKey {
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(a.tool)) return 'approvals.kind.codeChange';
  if (a.tool === 'Bash') return 'approvals.kind.command';
  if (a.tool === 'WebFetch' || a.tool === 'WebSearch') return 'approvals.kind.network';
  return 'approvals.kind.tool';
}

export const providerName: Record<AgentSession['provider'], string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
