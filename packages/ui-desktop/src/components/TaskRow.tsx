import type { CSSProperties, KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';
import { ProgressBar } from './ProgressBar';
import { RepoChip } from './RepoChip';
import { StatusPill, type Tone } from './StatusPill';

export interface TaskRowProps {
  ticket: string;
  title: string;
  repos?: string[] | undefined;
  progress?: number | undefined;
  tone?: Tone | undefined;
  statusLabel: string;
  pr?: string | undefined;
  icon?: IconName | undefined;
  selected?: boolean | undefined;
  index?: number | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

export function TaskRow({ ticket, title, repos = [], progress, tone = 'idle', statusLabel, pr, icon = 'ticket', selected, index, onClick, className }: TaskRowProps) {
  const live = tone === 'live';
  const style = index != null ? ({ '--i': index } as CSSProperties) : undefined;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={onKey} className={['cd-row', live && 'is-live', selected && 'is-selected', className].filter(Boolean).join(' ')} style={style}>
      <span className="cd-row__icon">
        <Icon name={icon} size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="cd-row__top">
          <span className="cd-row__key">{ticket}</span>
          <span className="cd-row__title">{title}</span>
        </div>
        <div className="cd-row__meta">
          {progress != null ? <ProgressBar value={progress} running={live} tone={tone === 'attention' ? 'amber' : tone === 'waiting' ? 'sky' : undefined} /> : null}
          {repos.map((r, i) => (
            <RepoChip key={r} name={r} size="sm" index={i} />
          ))}
        </div>
      </div>
      <div className="cd-row__end">
        {pr ? <span className="cd-row__key">{pr}</span> : null}
        <StatusPill key={tone} tone={tone}>
          {statusLabel}
        </StatusPill>
      </div>
      <Icon name="chevron" className="cd-row__chev" />
    </div>
  );
}
