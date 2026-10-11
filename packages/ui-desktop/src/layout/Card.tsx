import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  icon?: IconName | undefined;
  count?: number | undefined;
  action?: { label: string; onClick: () => void } | undefined;
  compact?: boolean | undefined;
  hero?: boolean | undefined;
  live?: boolean | undefined;
  children: ReactNode;
}

export function Card({ title, icon, count, action, compact, hero, live, className, children, ...rest }: CardProps) {
  return (
    <section {...rest} className={['cd-card', compact && 'cd-card--compact', hero && 'cd-card--hero', live && 'cd-card--live', className].filter(Boolean).join(' ')}>
      {title ? (
        <div className="cd-card__head">
          <span className="cd-card__title">
            {icon ? <Icon name={icon} size={18} /> : null}
            {title}
            {count ? <span className="cd-count">{count}</span> : null}
          </span>
          {action ? (
            <button type="button" className="cd-card__link" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
