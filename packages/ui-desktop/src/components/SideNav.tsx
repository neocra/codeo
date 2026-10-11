import { useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { useIndicator } from './useIndicator';

export interface NavItem {
  id: string;
  label: string;
  icon?: IconName | undefined;
  badge?: number | undefined;
}
export interface SideNavProps {
  items: NavItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
  className?: string | undefined;
}

/** Main navigation: an active rail slides between destinations, with a mint glowing edge. */
export function SideNav({ items, value, onChange, label = 'Navigation', className }: SideNavProps) {
  const ref = useRef<HTMLElement>(null);
  const box = useIndicator(ref, '[aria-current="page"]', [value, items.length], 'y');
  return (
    <nav ref={ref} className={['cd-nav', className].filter(Boolean).join(' ')} aria-label={label}>
      {box ? <span className="cd-nav__ind" aria-hidden style={{ height: `${box.size}px`, transform: `translateY(${box.pos}px)` }} /> : null}
      {items.map((it) => (
        <button key={it.id} type="button" className="cd-nav__item" aria-current={it.id === value ? 'page' : undefined} onClick={() => onChange(it.id)}>
          {it.icon ? <Icon name={it.icon} size={20} /> : null}
          {it.label}
          {it.badge ? (
            <span key={`b${it.badge}`} className="cd-nav__badge">
              {it.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
