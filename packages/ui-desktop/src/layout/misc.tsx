import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export function EmptyState({ title, body, action, icon = 'session' }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: IconName | undefined }) {
  return (
    <div className="cd-empty">
      <Icon name={icon} size={28} />
      <div className="cd-empty__title">{title}</div>
      {body ? <div className="cd-body-sm">{body}</div> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | undefined; children: ReactNode }) {
  return (
    <div className={`cd-banner cd-banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'info' ? 'shield' : 'alert'} size={16} />
      <span>{children}</span>
    </div>
  );
}

/** Visible marker for anything not implemented yet — never a silent dead control. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="cd-placeholder">{children}</span>;
}

export function Overline({ children }: { children: ReactNode }) {
  return <div className="cd-overline">{children}</div>;
}
