import type { ReactNode } from 'react';

export type Tone = 'live' | 'attention' | 'waiting' | 'done' | 'error' | 'idle';

export interface StatusPillProps {
  tone?: Tone | undefined;
  children?: ReactNode;
  className?: string | undefined;
}

/** One word of status with a dot. Give it `key={tone}` so a tone change re-enters. */
export function StatusPill({ tone = 'idle', children, className }: StatusPillProps) {
  return (
    <span className={['cd-pill', `cd-pill--${tone}`, className].filter(Boolean).join(' ')} role="status">
      <span className="cd-pill__dot" aria-hidden />
      {children}
    </span>
  );
}
