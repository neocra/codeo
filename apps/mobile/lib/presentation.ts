import type { AgentProviderId, AgentRole, ApprovalRequest, SessionStatus, TaskStatus } from '@codeo/domain';
import type { ConnectionState } from '@codeo/remote-client';
import type { MessageKey, Translator } from '@codeo/i18n';
import type { PillTone } from '@codeo/ui-mobile';

export interface Pill {
  tone: PillTone;
  label: string;
}

const SESSION_PILLS: Record<SessionStatus, { tone: PillTone; key: MessageKey }> = {
  created: { tone: 'waiting', key: 'status.created' },
  running: { tone: 'live', key: 'status.sessionActive' },
  waiting_approval: { tone: 'attention', key: 'status.waitingApproval' },
  idle: { tone: 'idle', key: 'status.idle' },
  completed: { tone: 'done', key: 'status.done' },
  failed: { tone: 'error', key: 'status.failed' },
  cancelled: { tone: 'done', key: 'status.cancelled' },
  disconnected: { tone: 'error', key: 'status.disconnected' },
};

const TASK_PILLS: Record<TaskStatus, { tone: PillTone; key: MessageKey }> = {
  draft: { tone: 'idle', key: 'status.draft' },
  queued: { tone: 'waiting', key: 'status.queued' },
  running: { tone: 'live', key: 'status.running' },
  waiting_approval: { tone: 'attention', key: 'status.waitingApproval' },
  paused: { tone: 'idle', key: 'status.paused' },
  review: { tone: 'attention', key: 'status.review' },
  completed: { tone: 'done', key: 'status.completed' },
  failed: { tone: 'error', key: 'status.failed' },
  cancelled: { tone: 'done', key: 'status.cancelled' },
};

export function sessionPill(status: SessionStatus, t: Translator): Pill {
  const p = SESSION_PILLS[status];
  return { tone: p.tone, label: t(p.key) };
}

export function taskPill(status: TaskStatus, t: Translator): Pill {
  const p = TASK_PILLS[status];
  return { tone: p.tone, label: t(p.key) };
}

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['queued', 'running', 'paused', 'review'];
export const WAITING_TASK_STATUSES: readonly TaskStatus[] = ['waiting_approval'];
export const DONE_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];
export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = ['created', 'running', 'waiting_approval', 'idle'];
export const DONE_SESSION_STATUSES: readonly SessionStatus[] = ['completed', 'failed', 'cancelled', 'disconnected'];

export function providerLabel(provider: AgentProviderId, t: Translator): string {
  return t(`provider.${provider}`);
}

/** Agents are shown by their initial, never a logo. */
export function providerInitial(provider: AgentProviderId, t: Translator): string {
  return providerLabel(provider, t).slice(0, 1);
}

export function roleLabel(role: AgentRole, t: Translator): string {
  return t(`role.${role}`);
}

export function riskLabel(risk: ApprovalRequest['risk'], t: Translator): string {
  return t(`approvals.risk.${risk}`);
}

export function riskTone(risk: ApprovalRequest['risk']): PillTone {
  return risk === 'high' ? 'error' : risk === 'medium' ? 'attention' : 'done';
}

/** Maps a provider tool name onto the design's approval kinds. */
export function approvalKind(tool: string, t: Translator): string {
  const name = tool.toLowerCase();
  if (/(edit|write|patch|notebook|create_file|replace)/.test(name)) return t('approvals.kind.codeChange');
  if (/(bash|shell|exec|command|terminal)/.test(name)) return t('approvals.kind.command');
  if (/(fetch|web|http|network|search)/.test(name)) return t('approvals.kind.network');
  return t('approvals.kind.tool');
}

export function connectionStateLabel(state: ConnectionState, t: Translator): string {
  return t(`runtime.state.${state}`);
}

export function connectionTone(state: ConnectionState): PillTone {
  switch (state) {
    case 'connected':
      return 'live';
    case 'connecting':
    case 'reconnecting':
      return 'waiting';
    case 'closed':
      return 'error';
    case 'idle':
      return 'idle';
  }
}

/** "4:07" — tabular, for the expiry countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "12,4 s" for durations, mono. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)
    .toString()
    .padStart(2, '0')} s`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A one-line preview of a tool call's input: the first string value, or compact JSON. */
export function previewInput(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'text']) {
    const v = input[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  const first = Object.values(input).find((v) => typeof v === 'string');
  if (typeof first === 'string') return first;
  try {
    return JSON.stringify(input);
  } catch {
    return '';
  }
}
