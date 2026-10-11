import type { CSSProperties } from 'react';
import { Icon } from './Icon';

export interface RepoChipProps {
  name: string;
  size?: 'sm' | 'md' | undefined;
  /** Position in a group for the entrance stagger. */
  index?: number | undefined;
  className?: string | undefined;
}

export function RepoChip({ name, size = 'md', index, className }: RepoChipProps) {
  const style = index != null ? ({ '--i': index } as CSSProperties) : undefined;
  return (
    <span className={['cd-chip', size === 'sm' && 'cd-chip--sm', className].filter(Boolean).join(' ')} style={style}>
      <Icon name="branch" size={size === 'sm' ? 12 : 14} />
      {name}
    </span>
  );
}
