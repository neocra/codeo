import { Avatar } from './Avatar';
import { StatusPill, type Tone } from './StatusPill';

export type AgentStatus = 'active' | 'waiting' | 'done' | 'idle' | 'error';
const PILL: Record<AgentStatus, Tone> = { active: 'live', waiting: 'waiting', done: 'done', idle: 'idle', error: 'error' };

export interface AgentCardProps {
  name: string;
  role?: string | undefined;
  status?: AgentStatus | undefined;
  statusLabel: string;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

export function AgentCard({ name, role, status = 'idle', statusLabel, onClick, className }: AgentCardProps) {
  return (
    <div className={['cd-agent', `is-${status}`, onClick && 'cd-agent--clickable', className].filter(Boolean).join(' ')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} style={onClick ? { cursor: 'pointer' } : undefined}>
      <Avatar name={name} />
      <div className="cd-agent__text">
        <div className="cd-agent__name">{name}</div>
        {role ? <div className="cd-agent__role">{role}</div> : null}
      </div>
      <StatusPill key={status} tone={PILL[status]}>
        {statusLabel}
      </StatusPill>
    </div>
  );
}
