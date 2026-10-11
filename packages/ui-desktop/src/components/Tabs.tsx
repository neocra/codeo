import { useRef, useState } from 'react';
import { useIndicator } from './useIndicator';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}
export interface TabsProps {
  items: TabItem[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((id: string) => void) | undefined;
  /** pill (filters) · underline (panel sections) */
  variant?: 'pill' | 'underline' | undefined;
  className?: string | undefined;
}

export function Tabs({ items, value, defaultValue, onChange, variant = 'pill', className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const current = value ?? inner;
  const ref = useRef<HTMLDivElement>(null);
  const box = useIndicator(ref, '[aria-selected="true"]', [current, items.length], 'x');
  const pick = (id: string) => {
    setInner(id);
    onChange?.(id);
  };
  return (
    <div ref={ref} role="tablist" className={['cd-tabs', variant === 'underline' && 'cd-tabs--underline', className].filter(Boolean).join(' ')}>
      {box ? <span className="cd-tabs__ind" aria-hidden style={{ width: `${box.size}px`, transform: `translateX(${box.pos}px)` }} /> : null}
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" className="cd-tab" aria-selected={it.id === current} tabIndex={it.id === current ? 0 : -1} onClick={() => pick(it.id)}>
          {it.label}
          {it.count != null ? <span className="cd-tab__count">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
